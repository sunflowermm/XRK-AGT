"""向量服务模块

提供文本向量化、向量检索和向量入库功能。

主要功能：
- 文本向量化：使用 SentenceTransformer 模型将文本转换为向量
- 向量检索：基于向量相似度进行语义搜索
- 向量入库：批量存储文档向量到 ChromaDB

特性：
- 异步模型加载，支持重试机制
- 嵌入结果缓存，提升性能
- 自动管理向量数据库连接
"""

from typing import Optional, Dict, Any, List
import asyncio
import logging
import time
from dataclasses import dataclass
from functools import lru_cache

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
    """向量服务类
    
    提供文本向量化、向量检索和向量入库功能。
    支持模型懒加载、结果缓存和自动重试机制。
    """

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
        """异步加载嵌入模型（优化版，带重试机制）"""
        if self._embedding_model is not None:
            return True
        if self._model_loading:
            return False

        async with self.model_load_lock:
            if self._embedding_model is not None:
                return True
            if self._model_loading:
                return False

            self._model_loading = True
            try:
                model_name = config.get("vector.model", "paraphrase-multilingual-MiniLM-L12-v2")
                device = config.get("vector.device", "cpu")
                
                from core.config import get_model_cache_dir
                cache_dir = get_model_cache_dir()
                cache_dir.mkdir(parents=True, exist_ok=True)
                cache_dir_str = str(cache_dir)

                load_timeout = config.get("vector.load_timeout", 300.0)
                max_retries = config.get("vector.load_retries", 3)
                
                model_cache_path = cache_dir / "models--" + model_name.replace("/", "--")
                snapshots_dir = model_cache_path / "snapshots"
                has_local_model = model_cache_path.exists() and snapshots_dir.exists() and any(snapshots_dir.iterdir())
                local_files_only = has_local_model or config.get("vector.local_files_only", False)
                
                if has_local_model:
                    logger.info("使用本地模型缓存: %s", model_name)
                
                last_error = None
                error_type = None
                for attempt in range(1, max_retries + 1):
                    try:
                        def _load_model():
                            import os
                            os.environ.setdefault("HF_HOME", cache_dir_str)
                            os.environ.setdefault("HF_HUB_CACHE", cache_dir_str)
                            return SentenceTransformer(
                                model_name,
                                device=device,
                                local_files_only=local_files_only,
                                cache_folder=cache_dir_str,
                            )
                        
                        self._embedding_model = await asyncio.wait_for(
                            asyncio.get_event_loop().run_in_executor(None, _load_model),
                            timeout=load_timeout,
                        )
                        
                        if self._embedding_model:
                            logger.info("嵌入模型加载成功: %s", model_name)
                            return True
                        raise RuntimeError("模型加载返回 None")
                            
                    except asyncio.TimeoutError:
                        last_error = f"超时 ({load_timeout}s)"
                        error_type = "timeout"
                        if attempt < max_retries:
                            await asyncio.sleep(2 ** attempt)
                        continue
                    except Exception as e:
                        last_error = str(e)
                        error_msg = last_error.lower()
                        
                        if any(kw in error_msg for kw in ["client has been closed", "connection", "network"]):
                            error_type = "network"
                            if attempt < max_retries:
                                await asyncio.sleep(2 ** attempt)
                                continue
                        elif "local_files_only" in error_msg or "not found" in error_msg:
                            error_type = "not_found"
                            break
                        else:
                            error_type = "unknown"
                            if attempt < max_retries:
                                await asyncio.sleep(2 ** attempt)
                                continue
                            break
                
                if error_type == "network":
                    logger.warning("嵌入模型下载失败（网络错误）: %s", model_name)
                elif error_type == "not_found":
                    logger.warning("嵌入模型未找到: %s", model_name)
                else:
                    logger.warning("嵌入模型加载失败: %s", model_name)
                
                self._model_load_failed = True
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

                self._vector_client = chromadb.PersistentClient(
                    path=str(persist_path),
                    settings=chromadb.config.Settings(
                        allow_reset=config.get("vector.allow_reset", False),
                        anonymized_telemetry=config.get(
                            "vector.anonymized_telemetry", False
                        ),
                    ),
                )

            except Exception as e:
                logger.error("向量数据库初始化失败: %s", e, exc_info=True)
                self._vector_client = None

        return self._vector_client

    @property
    def embedding_model(self) -> Optional[SentenceTransformer]:
        """获取嵌入模型实例"""
        return self._embedding_model

    async def embed_texts(
        self, texts: List[str], use_cache: bool = True
    ) -> List[EmbeddingResult]:
        """批量向量化文本（优化版）"""
        if not texts:
            return []

        if not await self.load_embedding_model():
            raise HTTPException(status_code=503, detail="向量化服务不可用")

        results = []
        texts_to_encode = []

        if use_cache:
            for text in texts:
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

        if texts_to_encode:
            try:
                def _encode_texts():
                    return self.embedding_model.encode(
                        texts_to_encode,
                        convert_to_numpy=True,
                        show_progress_bar=False,
                        batch_size=config.get("vector.batch_size", 32),
                    )
                
                embeddings = await asyncio.get_event_loop().run_in_executor(None, _encode_texts)

                for i, (text, embedding) in enumerate(zip(texts_to_encode, embeddings)):
                    embedding_list = self._convert_to_list(embedding)
                    results.append(
                        EmbeddingResult(
                            text=text,
                            embedding=embedding_list,
                            dimension=len(embedding_list),
                        )
                    )

                    if use_cache:
                        self._set_cache(text, embedding_list)

            except Exception as e:
                error_msg = str(e)[:200]
                logger.error("文本向量化失败: %s", error_msg)
                raise HTTPException(status_code=500, detail=f"文本向量化失败: {error_msg}")

        return results

    async def search_similar(
        self, query: str, collection: str = None, top_k: int = 5
    ) -> List[SearchResult]:
        """向量相似度搜索（优化版）"""
        if not isinstance(query, str) or not query.strip():
            raise HTTPException(status_code=400, detail="查询文本不能为空")

        collection = collection or config.get("vector.default_collection", "default")
        top_k = max(1, min(top_k, config.get("vector.max_top_k", 100)))

        client = self.get_vector_client()
        if not client:
            return []

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

            documents = results.get("documents", [[]])[0]
            if not documents:
                return []

            ids = results.get("ids", [[]])[0]
            distances = results.get("distances", [[]])[0]
            metadatas = results.get("metadatas", [[]])[0]

            formatted_results = [
                SearchResult(
                    id=ids[i] if i < len(ids) else f"doc_{i}",
                    text=doc,
                    score=round(max(0, 1 - (distances[i] if i < len(distances) else 0.0)), 4),
                    metadata=metadatas[i] if i < len(metadatas) else {},
                )
                for i, doc in enumerate(documents)
            ]

            return formatted_results

        except Exception as e:
            error_msg = str(e)[:200]
            logger.error("向量搜索失败: %s", error_msg)
            raise HTTPException(status_code=500, detail=f"向量搜索失败: {error_msg}")

    async def upsert_documents(
        self, documents: List[Dict[str, Any]], collection: str = None
    ) -> Dict[str, Any]:
        """批量向量入库（优化版）"""
        if not isinstance(documents, list) or not documents:
            raise HTTPException(status_code=400, detail="文档列表不能为空")

        collection = collection or config.get("vector.default_collection", "default")
        client = self.get_vector_client()
        if not client:
            raise HTTPException(status_code=503, detail="向量数据库服务不可用")

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

        embed_results = await self.embed_texts(texts)

        try:
            coll = client.get_or_create_collection(collection)
            embeddings = [result.embedding for result in embed_results]

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
            error_msg = str(e)[:200]
            logger.error("向量入库失败: %s", error_msg)
            raise HTTPException(status_code=500, detail=f"向量入库失败: {error_msg}")

    def get_health_status(self) -> Dict[str, Any]:
        """获取服务健康状态"""
        from core.config import get_model_cache_dir
        cache_dir = get_model_cache_dir()
        model_name = config.get("vector.model", "paraphrase-multilingual-MiniLM-L12-v2")
        model_cache_path = cache_dir / "models--" + model_name.replace("/", "--")
        snapshots_dir = model_cache_path / "snapshots"
        model_cached = model_cache_path.exists() and snapshots_dir.exists() and any(snapshots_dir.iterdir())
        
        return {
            "vector_db": bool(self.get_vector_client()),
            "embedding_model": bool(self.embedding_model),
            "model_loading": self._model_loading,
            "model_cached": model_cached,
            "cache_enabled": self._cache_enabled,
            "cache_size": len(self._embedding_cache),
            "persist_dir": str(
                resolve_path(
                    config.get("vector.persist_dir", "data/subserver/vector_db")
                )
            ),
            "model": model_name,
            "model_cache_path": str(model_cache_path) if model_cached else None,
            "device": config.get("vector.device", "cpu"),
        }


# 全局服务实例
vector_service = VectorService()


# API处理函数
async def embed_handler(request: Request):
    """向量化文本接口"""
    data = await request.json()
    texts = data.get("texts", [])

    if not isinstance(texts, list) or not texts:
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
    }


async def search_handler(request: Request):
    """向量检索接口"""
    data = await request.json()
    query = data.get("query")
    collection = data.get("collection")
    top_k = max(1, min(int(data.get("top_k", 5)), 100))

    if not isinstance(query, str) or not query.strip():
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
