"""Vector Service - 向量服务
提供向量化、向量检索、向量数据库管理等功能
"""
from fastapi import Request, HTTPException
import logging
import numpy as np
from core.config import Config, resolve_path

logger = logging.getLogger(__name__)
config = Config()


def _convert_to_list(emb):
    """将 embedding 转换为列表格式（兼容 tensor、numpy array、list）"""
    # 处理 PyTorch tensor
    if hasattr(emb, 'cpu') and hasattr(emb, 'detach'):
        emb = emb.cpu().detach().numpy()
    # 处理 numpy array
    if isinstance(emb, np.ndarray):
        return emb.tolist()
    # 处理其他可迭代对象
    if hasattr(emb, '__iter__') and not isinstance(emb, (str, bytes)):
        return [float(x) for x in emb]
    # 如果是单个值，直接返回
    return float(emb) if isinstance(emb, (int, float)) else emb

# 全局模型实例（延迟加载）
_embedding_model = None
_vector_client = None


def get_embedding_model():
    """获取或创建嵌入模型实例（单例模式，从配置读取模型名称）"""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            model_name = config.get("vector.model", "paraphrase-multilingual-MiniLM-L12-v2")
            _embedding_model = SentenceTransformer(model_name)
            logger.info(f"嵌入模型加载成功: {model_name}")
        except ImportError:
            logger.warning("sentence_transformers未安装，向量化功能将不可用")
            _embedding_model = False
        except Exception as e:
            logger.error(f"嵌入模型加载失败: {e}", exc_info=True)
            _embedding_model = False
    return _embedding_model if _embedding_model is not False else None


def get_vector_client():
    """获取或创建向量数据库客户端（单例模式，从配置读取持久化目录）"""
    global _vector_client
    if _vector_client is None:
        try:
            import chromadb
            persist_dir = config.get("vector.persist_dir", "data/subserver/vector_db")
            # 转换为绝对路径
            persist_path = resolve_path(persist_dir)
            persist_path.mkdir(parents=True, exist_ok=True)
            
            _vector_client = chromadb.PersistentClient(path=str(persist_path))
            logger.info(f"向量数据库客户端初始化成功: {persist_path}")
        except ImportError:
            logger.warning("chromadb未安装，向量检索功能将不可用")
            _vector_client = False
        except Exception as e:
            logger.error(f"向量数据库客户端初始化失败: {e}", exc_info=True)
            _vector_client = False
    return _vector_client if _vector_client is not False else None


async def embed_handler(request: Request):
    """向量化文本接口"""
    try:
        data = await request.json()
        texts = data.get("texts", [])
        
        if not texts or not isinstance(texts, list):
            raise HTTPException(status_code=400, detail="缺少texts参数或格式错误")
        
        model = get_embedding_model()
        if model is None:
            raise HTTPException(
                status_code=503,
                detail="向量化服务不可用，请安装sentence_transformers: pip install sentence-transformers"
            )
        
        embeddings_list = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
        
        embeddings = []
        for text, emb in zip(texts, embeddings_list):
            emb_list = _convert_to_list(emb)
            embeddings.append({
                "text": text,
                "embedding": emb_list,
                "dimension": len(emb_list)
            })
        
        return {
            "success": True,
            "embeddings": embeddings,
            "count": len(embeddings)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"向量化接口异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def search_handler(request: Request):
    """向量检索接口"""
    try:
        data = await request.json()
        query = data.get("query")
        collection = data.get("collection", "default")
        top_k = data.get("top_k", 5)
        
        if not query or not isinstance(query, str):
            raise HTTPException(status_code=400, detail="缺少query参数或格式错误")
        
        if not isinstance(collection, str):
            raise HTTPException(status_code=400, detail="collection参数格式错误")
        
        if not isinstance(top_k, int) or top_k <= 0:
            top_k = 5
        
        client = get_vector_client()
        model = get_embedding_model()
        
        if client is None or model is None:
            logger.warning("向量数据库或模型不可用，返回空结果")
            return {
                "success": True,
                "results": [],
                "count": 0,
                "message": "向量数据库服务不可用"
            }
        
        coll = client.get_or_create_collection(collection)
        query_embedding_raw = model.encode([query], convert_to_numpy=True, show_progress_bar=False)[0]
        query_embedding = _convert_to_list(query_embedding_raw)
        
        results = coll.query(query_embeddings=[query_embedding], n_results=min(top_k, 100))
        
        formatted_results = []
        if results.get('documents') and results['documents'][0]:
            for i, doc in enumerate(results['documents'][0]):
                distance = results['distances'][0][i] if results.get('distances') else 0.0
                score = max(0, 1 - distance)
                formatted_results.append({
                    "id": results['ids'][0][i] if results.get('ids') else f"doc_{i}",
                    "text": doc,
                    "score": round(score, 4),
                    "metadata": results['metadatas'][0][i] if results.get('metadatas') else {}
                })
        
        return {
            "success": True,
            "results": formatted_results,
            "count": len(formatted_results)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"向量检索接口异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def upsert_handler(request: Request):
    """向量入库接口"""
    try:
        data = await request.json()
        collection = data.get("collection", "default")
        documents = data.get("documents", [])
        
        if not documents or not isinstance(documents, list):
            raise HTTPException(status_code=400, detail="缺少documents参数或格式错误")
        
        if not isinstance(collection, str):
            raise HTTPException(status_code=400, detail="collection参数格式错误")
        
        client = get_vector_client()
        model = get_embedding_model()
        
        if client is None or model is None:
            raise HTTPException(
                status_code=503,
                detail="向量数据库服务不可用，请安装chromadb和sentence_transformers"
            )
        
        coll = client.get_or_create_collection(collection)
        
        texts = [doc.get("text", "") if isinstance(doc, dict) else str(doc) for doc in documents]
        if not all(texts):
            raise HTTPException(status_code=400, detail="文档文本不能为空")
        
        embeddings_raw = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
        embeddings = [_convert_to_list(emb) for emb in embeddings_raw]
        
        ids = [doc.get("id", f"doc_{i}") if isinstance(doc, dict) else f"doc_{i}" 
               for i, doc in enumerate(documents)]
        metadatas = [doc.get("metadata", {}) if isinstance(doc, dict) else {} 
                    for doc in documents]
        
        coll.add(
            embeddings=embeddings,
            documents=texts,
            ids=ids,
            metadatas=metadatas
        )
        
        return {
            "success": True,
            "collection": collection,
            "inserted": len(documents)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"向量入库接口异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


default = {
    "name": "vector-service",
    "description": "向量服务",
    "priority": 100,
    "routes": [
        {
            "method": "POST",
            "path": "/api/vector/embed",
            "handler": embed_handler
        },
        {
            "method": "POST",
            "path": "/api/vector/search",
            "handler": search_handler
        },
        {
            "method": "POST",
            "path": "/api/vector/upsert",
            "handler": upsert_handler
        }
    ]
}
