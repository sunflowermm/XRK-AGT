"""向量服务优化模块"""

from typing import Optional, Dict, Any, List
import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import lru_cache

# 在导入任何 HuggingFace 相关库之前，确保离线模式已设置
if os.getenv("HF_HUB_OFFLINE") != "1":
    os.environ["HF_HUB_OFFLINE"] = "1"

import numpy as np
from sentence_transformers import SentenceTransformer
import chromadb
from fastapi import Request, HTTPException

from core.config import Config, resolve_path

logger = logging.getLogger(__name__)
config = Config()


@dataclass
class EmbeddingResult:
    """嵌入结果"""

    text: str
    embedding: List[float]
    dimension: int


@dataclass
class SearchResult:
    """搜索结果"""

    id: str
    text: str
    score: float
    metadata: Dict[str, Any]


class VectorService:
    """优化后的向量服务"""

    def __init__(self):
        self._embedding_model: Optional[SentenceTransformer] = None
        self._vector_client: Optional[chromadb.PersistentClient] = None
        self._model_loading = False
        self._model_load_lock: Optional[asyncio.Lock] = None
        self._cache_enabled = config.get("vector.cache_enabled", True)
        self._cache_ttl = config.get("vector.cache_ttl", 300)  # 5分钟缓存
        self._embedding_cache: Dict[str, tuple] = {}
        self._model_load_failed = False

    @property
    def model_load_lock(self) -> asyncio.Lock:
        """获取模型加载锁"""
        if self._model_load_lock is None:
            self._model_load_lock = asyncio.Lock()
        return self._model_load_lock

    @lru_cache(maxsize=1024)
    def _convert_to_list(self, emb: np.ndarray) -> List[float]:
        """转换嵌入为列表格式（带缓存）"""
        return emb.tolist() if isinstance(emb, np.ndarray) else [float(x) for x in emb]

    def _get_cache_key(self, text: str) -> str:
        """生成缓存键"""
        return f"{hash(text)}_{config.get('vector.model', 'paraphrase-multilingual-MiniLM-L12-v2')}"

    def _get_from_cache(self, text: str) -> Optional[List[float]]:
        """从缓存获取嵌入"""
        if not self._cache_enabled:
            return None

        key = self._get_cache_key(text)
        if key in self._embedding_cache:
            embedding, timestamp = self._embedding_cache[key]
            if time.time() - timestamp < self._cache_ttl:
                return embedding
            else:
                del self._embedding_cache[key]
        return None

    def _set_cache(self, text: str, embedding: List[float]):
        """设置缓存"""
        if not self._cache_enabled:
            return

        key = self._get_cache_key(text)
        self._embedding_cache[key] = (embedding, time.time())

        # 清理过期缓存
        current_time = time.time()
        expired_keys = [
            k
            for k, (_, ts) in self._embedding_cache.items()
            if current_time - ts >= self._cache_ttl
        ]
        for k in expired_keys:
            del self._embedding_cache[k]

    async def load_embedding_model(self) -> bool:
        """异步加载嵌入模型（优化版）"""
        if self._embedding_model is not None or self._model_loading:
            return self._embedding_model is not None

        async with self.model_load_lock:
            if self._embedding_model is not None or self._model_loading:
                return self._embedding_model is not None

            self._model_loading = True
            try:
                model_name = config.get(
                    "vector.model", "paraphrase-multilingual-MiniLM-L12-v2"
                )
                device = config.get("vector.device", "cpu")
                
                # 使用统一的缓存目录解析逻辑
                from core.config import get_model_cache_dir
                cache_dir = get_model_cache_dir()
                cache_dir.mkdir(parents=True, exist_ok=True)
                cache_dir_str = str(cache_dir)

                local_files_only = config.get("vector.local_files_only", False)
                load_timeout = config.get("vector.load_timeout", 300.0)
                
                logger.info("加载嵌入模型: %s (设备: %s, 缓存目录: %s, local_files_only: %s, 超时: %ds)", 
                           model_name, device, cache_dir_str, local_files_only, int(load_timeout))

                # 使用线程池异步加载模型
                try:
                    self._embedding_model = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(
                            None,
                            lambda: SentenceTransformer(
                                model_name,
                                device=device,
                                local_files_only=local_files_only,
                                cache_folder=cache_dir_str,
                            ),
                        ),
                        timeout=load_timeout,
                    )
                    logger.info("嵌入模型加载成功: %s (设备: %s)", model_name, device)
                    return True
                except asyncio.TimeoutError:
                    logger.error("嵌入模型加载超时: %s", model_name)
                    self._embedding_model = False
                    return False
                except Exception as e:
                    error_msg = str(e)
                    if "local_files_only" in error_msg.lower() or "not found" in error_msg.lower():
                        logger.error("嵌入模型加载失败: %s", error_msg)
                        logger.error("请确保模型文件已完整下载到缓存目录: %s", cache_dir_str)
                    else:
                        logger.error("嵌入模型加载失败: %s", error_msg, exc_info=True)
                    self._embedding_model = False
                    return False
            finally:
                self._model_loading = False

    def get_vector_client(self) -> Optional[chromadb.PersistentClient]:
        """获取或创建向量数据库客户端（优化版）"""
        if self._vector_client is None:
            try:
                persist_path = resolve_path(
                    config.get("vector.persist_dir", "data/subserver/vector_db")
                )
                persist_path.mkdir(parents=True, exist_ok=True)

                # 优化配置
                self._vector_client = chromadb.PersistentClient(
                    path=str(persist_path),
                    settings=chromadb.config.Settings(
                        allow_reset=config.get("vector.allow_reset", False),
                        anonymized_telemetry=config.get(
                            "vector.anonymized_telemetry", False
                        ),
                    ),
                )
                logger.debug("向量数据库客户端初始化成功")

            except Exception as e:
                logger.error("向量数据库初始化失败: %s", e, exc_info=True)
                self._vector_client = False

        return self._vector_client if self._vector_client is not False else None

    @property
    def embedding_model(self) -> Optional[SentenceTransformer]:
        """获取嵌入模型实例"""
        return self._embedding_model if self._embedding_model is not False else None

    async def embed_texts(
        self, texts: List[str], use_cache: bool = True
    ) -> List[EmbeddingResult]:
        """批量向量化文本（优化版）"""
        if not texts:
            return []

        # 确保模型已加载
        if not await self.load_embedding_model():
            raise HTTPException(status_code=503, detail="向量化服务不可用")

        results = []
        texts_to_encode = []
        indices_to_encode = []

        # 检查缓存
        if use_cache:
            for i, text in enumerate(texts):
                cached_embedding = self._get_from_cache(text)
                if cached_embedding is not None:
                    results.append(
                        EmbeddingResult(
                            text=text,
                            embedding=cached_embedding,
                            dimension=len(cached_embedding),
                        )
                    )
                else:
                    texts_to_encode.append(text)
                    indices_to_encode.append(i)

        # 编码未缓存的文本
        if texts_to_encode:
            try:
                embeddings = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: self.embedding_model.encode(
                        texts_to_encode,
                        convert_to_numpy=True,
                        show_progress_bar=False,
                        batch_size=config.get("vector.batch_size", 32),
                    ),
                )

                for i, (text, embedding) in enumerate(zip(texts_to_encode, embeddings)):
                    embedding_list = self._convert_to_list(embedding)
                    results.append(
                        EmbeddingResult(
                            text=text,
                            embedding=embedding_list,
                            dimension=len(embedding_list),
                        )
                    )

                    # 更新缓存
                    if use_cache:
                        self._set_cache(text, embedding_list)

            except Exception as e:
                logger.error("文本向量化失败: %s", e, exc_info=True)
                raise HTTPException(status_code=500, detail=f"文本向量化失败: {str(e)}")

        # 按原始顺序排序结果
        if use_cache and indices_to_encode:
            sorted_results = [None] * len(texts)
            cache_idx = 0
            encode_idx = 0
            for i in range(len(texts)):
                if cache_idx < len(results) and results[cache_idx].text == texts[i]:
                    sorted_results[i] = results[cache_idx]
                    cache_idx += 1
                else:
                    sorted_results[i] = results[
                        len(texts) - len(texts_to_encode) + encode_idx
                    ]
                    encode_idx += 1
            results = sorted_results

        return results

    async def search_similar(
        self, query: str, collection: str = None, top_k: int = 5
    ) -> List[SearchResult]:
        """向量相似度搜索（优化版）"""
        if not query or not isinstance(query, str):
            raise HTTPException(status_code=400, detail="查询文本不能为空")

        collection = collection or config.get("vector.default_collection", "default")
        top_k = max(1, min(top_k, config.get("vector.max_top_k", 100)))

        client = self.get_vector_client()
        if not client:
            return []

        # 获取查询嵌入
        embed_results = await self.embed_texts([query])
        if not embed_results:
            return []

        query_embedding = embed_results[0].embedding

        try:
            coll = client.get_or_create_collection(collection)
            results = coll.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                include=["documents", "metadatas", "distances"],
            )

            if not results.get("documents") or not results["documents"][0]:
                return []

            formatted_results = [
                SearchResult(
                    id=results["ids"][0][i] if results.get("ids") else f"doc_{i}",
                    text=doc,
                    score=round(
                        max(
                            0,
                            1
                            - (
                                results["distances"][0][i]
                                if results.get("distances")
                                else 0.0
                            ),
                        ),
                        4,
                    ),
                    metadata=results["metadatas"][0][i]
                    if results.get("metadatas")
                    else {},
                )
                for i, doc in enumerate(results["documents"][0])
            ]

            return formatted_results

        except Exception as e:
            logger.error("向量搜索失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"向量搜索失败: {str(e)}")

    async def upsert_documents(
        self, documents: List[Dict[str, Any]], collection: str = None
    ) -> Dict[str, Any]:
        """批量向量入库（优化版）"""
        if not documents or not isinstance(documents, list):
            raise HTTPException(status_code=400, detail="文档列表不能为空")

        collection = collection or config.get("vector.default_collection", "default")

        client = self.get_vector_client()
        if not client:
            raise HTTPException(status_code=503, detail="向量数据库服务不可用")

        # 提取文本
        texts = []
        ids = []
        metadatas = []

        for i, doc in enumerate(documents):
            if isinstance(doc, dict):
                text = doc.get("text", "").strip()
                doc_id = doc.get("id", f"doc_{i}")
                metadata = doc.get("metadata", {})
            else:
                text = str(doc).strip()
                doc_id = f"doc_{i}"
                metadata = {}

            if not text:
                continue

            texts.append(text)
            ids.append(doc_id)
            metadatas.append(metadata)

        if not texts:
            raise HTTPException(status_code=400, detail="所有文档文本都为空")

        # 批量向量化
        embed_results = await self.embed_texts(texts)

        try:
            coll = client.get_or_create_collection(collection)

            embeddings = [result.embedding for result in embed_results]

            # 使用 upsert 或 add
            if hasattr(coll, "upsert"):
                coll.upsert(
                    embeddings=embeddings, documents=texts, ids=ids, metadatas=metadatas
                )
            else:
                coll.add(
                    embeddings=embeddings, documents=texts, ids=ids, metadatas=metadatas
                )

            return {
                "success": True,
                "collection": collection,
                "inserted": len(texts),
                "cached_results": len(self._embedding_cache),
            }

        except Exception as e:
            logger.error("向量入库失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"向量入库失败: {str(e)}")

    def get_health_status(self) -> Dict[str, Any]:
        """获取服务健康状态"""
        return {
            "vector_db": bool(self.get_vector_client()),
            "embedding_model": bool(self.embedding_model),
            "model_loading": self._model_loading,
            "cache_enabled": self._cache_enabled,
            "cache_size": len(self._embedding_cache),
            "persist_dir": str(
                resolve_path(
                    config.get("vector.persist_dir", "data/subserver/vector_db")
                )
            ),
            "model": config.get(
                "vector.model", "paraphrase-multilingual-MiniLM-L12-v2"
            ),
            "device": config.get("vector.device", "cpu"),
        }


# 全局服务实例
vector_service = VectorService()


# API处理函数
async def embed_handler(request: Request):
    """向量化文本接口"""
    data = await request.json()
    texts = data.get("texts", [])

    if not texts or not isinstance(texts, list):
        raise HTTPException(status_code=400, detail="缺少texts参数或格式错误")

    results = await vector_service.embed_texts(texts)

    return {
        "success": True,
        "embeddings": [
            {
                "text": result.text,
                "embedding": result.embedding,
                "dimension": result.dimension,
            }
            for result in results
        ],
        "count": len(results),
        "cached": len([r for r in results if vector_service._get_from_cache(r.text)]),
    }


async def search_handler(request: Request):
    """向量检索接口"""
    data = await request.json()
    query = data.get("query")
    collection = data.get("collection")
    top_k = max(1, min(int(data.get("top_k", 5)), 100))

    if not query or not isinstance(query, str):
        raise HTTPException(status_code=400, detail="缺少query参数或格式错误")

    results = await vector_service.search_similar(query, collection, top_k)

    return {
        "success": True,
        "results": [
            {
                "id": result.id,
                "text": result.text,
                "score": result.score,
                "metadata": result.metadata,
            }
            for result in results
        ],
        "count": len(results),
    }


async def upsert_handler(request: Request):
    """向量入库接口"""
    data = await request.json()
    collection = data.get("collection")
    documents = data.get("documents", [])

    result = await vector_service.upsert_documents(documents, collection)
    return result


default = {
    "name": "vector-service",
    "description": "优化后的向量服务",
    "priority": 100,
    "routes": [
        {"method": "POST", "path": "/api/vector/embed", "handler": embed_handler},
        {"method": "POST", "path": "/api/vector/search", "handler": search_handler},
        {"method": "POST", "path": "/api/vector/upsert", "handler": upsert_handler},
        {
            "method": "GET",
            "path": "/api/vector/health",
            "handler": lambda _req: {
                "success": True,
                **vector_service.get_health_status(),
            },
        },
    ],
}
