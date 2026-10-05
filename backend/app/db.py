from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import DATABASE_URL
from app.models import Base

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db() -> None:
    """建表并对旧库幂等补齐小箴配额列与非负约束。"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 下列为 PostgreSQL 旧库补列/约束；create_all 已覆盖全新库与其它方言。
        if conn.dialect.name != "postgresql":
            return
        await conn.execute(
            text(
                "ALTER TABLE basins "
                "ADD COLUMN IF NOT EXISTS remaining_rounds INTEGER NOT NULL DEFAULT 0"
            )
        )
        await conn.execute(
            text("ALTER TABLE basins ADD COLUMN IF NOT EXISTS quota_updated_at TIMESTAMPTZ")
        )
        await conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_basins_remaining_rounds_nonneg'
                    ) THEN
                        ALTER TABLE basins
                            ADD CONSTRAINT ck_basins_remaining_rounds_nonneg
                            CHECK (remaining_rounds >= 0);
                    END IF;
                END$$;
                """
            )
        )


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
