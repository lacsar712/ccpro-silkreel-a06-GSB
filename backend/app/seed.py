from datetime import timedelta

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Basin, BathReading, Filature, User, utcnow
from app.security import hash_password

# 盆号 -> 初始剩余圈数。要求种子里恰有一盆为 1（甲-2），供并发登记对拍。
DEMO_ROUNDS = {
    "甲-1": 3,
    "甲-2": 1,
    "乙-1": 0,
    "乙-2": 2,
    "丙-1": 0,
    "丙-2": 0,
}


async def seed_demo() -> None:
    async with SessionLocal() as session:
        existing = await session.execute(select(User).where(User.username == "admin"))
        admin = existing.scalar_one_or_none()
        if admin is None:
            admin = User(username="admin", password_hash=hash_password("123456"), role="admin")
            session.add(admin)
        else:
            admin.password_hash = hash_password("123456")
            admin.role = "admin"

        existing_w = await session.execute(select(User).where(User.username == "worker"))
        worker = existing_w.scalar_one_or_none()
        if worker is None:
            session.add(User(username="worker", password_hash=hash_password("123456"), role="worker"))
        else:
            worker.password_hash = hash_password("123456")
            worker.role = "worker"

        mill = (await session.execute(select(Filature))).scalars().first()
        if mill:
            # 旧库回填：只补从未动过配额（quota_updated_at 为空）的演示盆，
            # 管理员补过圈或缫丝工扣过圈的盆一律不碰。
            basins = (
                await session.execute(select(Basin).where(Basin.filature_id == mill.id))
            ).scalars().all()
            for basin in basins:
                if basin.quota_updated_at is None and basin.code in DEMO_ROUNDS:
                    basin.remaining_rounds = DEMO_ROUNDS[basin.code]
            await session.commit()
            return

        mill = Filature(name="江口缫丝坞", riverside="东津渡")
        session.add(mill)
        await session.flush()
        now = utcnow()
        specs = [
            ("甲-1", Basin.STATUS_REELING, 40.5, 0),
            ("甲-2", Basin.STATUS_SOAKING, None, 1),
            ("乙-1", Basin.STATUS_REELED, 39.2, 2),
            ("乙-2", Basin.STATUS_REELING, 36.0, 3),
            ("丙-1", Basin.STATUS_SOAKING, None, 4),
            ("丙-2", Basin.STATUS_REELED, 41.0, 5),
        ]
        for code, status, temp, idx in specs:
            basin = Basin(
                filature_id=mill.id,
                code=code,
                status=status,
                ring_index=idx,
                remaining_rounds=DEMO_ROUNDS[code],
            )
            session.add(basin)
            await session.flush()
            if temp is not None:
                session.add(
                    BathReading(
                        basin_id=basin.id,
                        water_temp_c=temp,
                        operator="worker",
                        taken_at=now - timedelta(hours=2),
                    )
                )
        await session.commit()
