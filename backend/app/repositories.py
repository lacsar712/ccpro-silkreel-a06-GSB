from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Basin, BathReading, Filature, ReelQuota, User, utcnow


class QuotaExhausted(Exception):
    """剩余圈数为 0：本次汤温登记必须整体回滚，不得入库。"""


class UserRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def by_username(self, username: str) -> User | None:
        result = await self.session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()


class BasinRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def board(self) -> Filature | None:
        result = await self.session.execute(
            select(Filature).options(
                selectinload(Filature.basins).selectinload(Basin.readings),
                selectinload(Filature.basins).selectinload(Basin.quota),
            )
        )
        return result.scalars().first()

    async def get(self, basin_id: int) -> Basin | None:
        result = await self.session.execute(
            select(Basin)
            .options(selectinload(Basin.readings), selectinload(Basin.quota))
            .where(Basin.id == basin_id)
        )
        return result.scalar_one_or_none()

    async def consume_and_add_reading(
        self, basin_id: int, temp_c: float, operator: str
    ) -> None:
        """同一事务内：剩余圈数 > 0 才扣 1 并落汤温；为 0 则抛 QuotaExhausted，
        汤温绝不入库。

        用一句条件 UPDATE 当门槛——在 PostgreSQL 上并发的两个登记会在同一行
        锁上排队，后到者拿到锁后按已提交的新值重判 WHERE（0 不匹配），于是
        只剩一条汤温入库、扣圈与入库不可能分叉。
        """
        async with self.session.begin():
            result = await self.session.execute(
                update(ReelQuota)
                .where(
                    ReelQuota.basin_id == basin_id,
                    ReelQuota.remaining_turns > 0,
                )
                .values(
                    remaining_turns=ReelQuota.remaining_turns - 1,
                    updated_at=utcnow(),
                )
                .returning(ReelQuota.remaining_turns)
            )
            if result.scalar_one_or_none() is None:
                # 区分：盆不存在 vs 配额耗尽（都是回滚，什么都不写）
                exists = await self.session.execute(
                    select(Basin.id).where(Basin.id == basin_id)
                )
                if exists.scalar_one_or_none() is None:
                    raise LookupError(basin_id)
                raise QuotaExhausted(basin_id)
            reading = BathReading(
                basin_id=basin_id, water_temp_c=temp_c, operator=operator
            )
            self.session.add(reading)
            await self.session.flush()

    async def quotas(self, code_like: str | None = None) -> list[tuple[Basin, ReelQuota]]:
        """按盆列出配额，可按盆号模糊筛；始终含所有有配额的盆。"""
        stmt = (
            select(Basin, ReelQuota)
            .join(ReelQuota, ReelQuota.basin_id == Basin.id)
            .order_by(Basin.ring_index, Basin.id)
        )
        if code_like:
            stmt = stmt.where(Basin.code.ilike(f"%{code_like}%"))
        rows = await self.session.execute(stmt)
        return [(basin, quota) for basin, quota in rows.all()]

    async def refill_quota(self, basin_id: int, add_turns: int) -> tuple[int, datetime]:
        """管理员补圈：只加配额，不碰汤温与盆态。"""
        async with self.session.begin():
            result = await self.session.execute(
                update(ReelQuota)
                .where(ReelQuota.basin_id == basin_id)
                .values(
                    remaining_turns=ReelQuota.remaining_turns + add_turns,
                    updated_at=utcnow(),
                )
                .returning(ReelQuota.remaining_turns, ReelQuota.updated_at)
            )
            row = result.first()
            if row is None:
                raise LookupError(basin_id)
            return row[0], row[1]

    async def save_status(self, basin: Basin, status: str) -> None:
        basin.status = status
        await self.session.commit()
