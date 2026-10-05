# SilkReel-01 · 江口缫丝坞

缫丝盆环状作业台。登录后看到的是沿汤池围成一圈的盆位，点盆登记汤温并改状态——不是侧栏双列表 CRUD。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Quart（异步 Flask 族）· Hypercorn |
| 结构 | `repositories.py` 仓储 + `services.py` 门槛，路由不直接拼 SQL |
| 数据 | SQLAlchemy 2 async · asyncpg · PostgreSQL 15 |
| 前端 | Preact 10 · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4760
- API：http://localhost:8760
- PostgreSQL：localhost:6160

## 演示账号

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `123456` | 管理员 |
| `worker` | `123456` | 缫丝工 |

## 业务规则

盆状态不可标成「已缫完」，除非该盆**最近一条**汤温记录落在 **38～42℃**。规则在 `backend/app/services.py`。

### 小箴配额（每盆一把）

- 配额字段：盆、**剩余圈数**（≥0 的整数，DB 层有 CHECK 约束）、**更新时刻**，与盆一对一，见 `ReelQuota`。
- 登记汤温时先读剩余圈数；成功登记必须在**同一事务**内把剩余圈数减 1。扣减用一句条件 `UPDATE … WHERE remaining_turns > 0 … RETURNING` 当门槛，并发登记在同一行锁上排队，因此扣圈与入库不会分叉。
- 剩余圈数为 0 时再登记，返回中文错误且**汤温不入库**。
- **改盆态不扣圈**；已缫完的 38～42℃ 门槛照旧，圈数不掺进去。
- 缫丝工可在「小箴配额」专页查看全部盆的剩余圈数（可按盆号筛选）；管理员可在专页把圈数加回去。
- 种子数据中 `甲-2` 一盆剩余圈数为 1，便于验证两人并发各登一条时只入一条。

## 快速启动

```bash
cd SilkReel/SilkReel-01
docker compose up --build
```
