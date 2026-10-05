from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Basin, BathReading, Filature, User, utcnow
from app.services import QuotaError


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
                selectinload(Filature.basins).selectinload(Basin.readings)
            )
        )
        return result.scalars().first()

    async def exists(self, basin_id: int) -> bool:
        result = await self.session.execute(select(Basin.id).where(Basin.id == basin_id))
        return result.first() is not None

    async def get(self, basin_id: int) -> Basin | None:
        result = await self.session.execute(
            select(Basin)
            .options(selectinload(Basin.readings))
            .where(Basin.id == basin_id)
        )
        return result.scalar_one_or_none()

    async def list_quotas(self, code_like: str | None = None) -> list[Basin]:
        stmt = select(Basin).order_by(Basin.ring_index, Basin.id)
        if code_like:
            stmt = stmt.where(func.lower(Basin.code).like(f"%{code_like.lower()}%"))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def register_reading(
        self, basin_id: int, temp_c: float, operator: str
    ) -> BathReading:
        """登记汤温：同一事务内先原子扣 1 圈，再写汤温。

        行级闸门 ``UPDATE ... WHERE remaining_rounds > 0`` 让并发的两名缫丝工
        最多只有一人扣圈成功；扣不到（剩余 0）则抛 QuotaError，汤温不入库。
        """
        gated = await self.session.execute(
            update(Basin)
            .where(Basin.id == basin_id)
            .where(Basin.remaining_rounds > 0)
            .values(
                remaining_rounds=Basin.remaining_rounds - 1,
                quota_updated_at=utcnow(),
            )
            .returning(Basin.id)
        )
        if gated.first() is None:
            raise QuotaError("该盆小箴剩余圈数为 0，不能登记汤温，请联系管理员补圈")

        reading = BathReading(basin_id=basin_id, water_temp_c=temp_c, operator=operator)
        self.session.add(reading)
        # 扣圈与汤温在此一次提交：任一方失败整体回滚，绝不分叉。
        await self.session.commit()
        await self.session.refresh(reading)
        return reading

    async def add_rounds(self, basin_id: int, amount: int) -> bool:
        """管理员补圈：在现值上加正整数。返回盆是否存在。"""
        result = await self.session.execute(
            update(Basin)
            .where(Basin.id == basin_id)
            .values(
                remaining_rounds=Basin.remaining_rounds + amount,
                quota_updated_at=utcnow(),
            )
            .returning(Basin.id)
        )
        if result.first() is None:
            return False
        await self.session.commit()
        return True

    async def save_status(self, basin: Basin, status: str) -> None:
        basin.status = status
        await self.session.commit()
