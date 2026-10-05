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

- **已缫完门槛**：盆状态不可标成「已缫完」，除非该盆**最近一条**汤温记录落在 **38～42℃**。规则在 `backend/app/services.py`，与小箴圈数互不影响。
- **小箴配额**：每盆有「剩余圈数」。登记汤温时在**同一事务**内原子扣 1 圈——用
  `UPDATE basins SET remaining_rounds = remaining_rounds - 1 WHERE id=? AND remaining_rounds > 0`
  行级闸门放行后才插入汤温并一次提交。圈数为 0 时闸门不放行，中文挡住且汤温绝不入库；
  两名缫丝工并发各登一条，最多一条成功。改盆态不扣圈，圈数也不掺进已缫完门槛。
  缫丝工可在「小箴配额」专页查看（可按盆号筛选）；管理员可在该页把剩余圈数加回去。
  种子数据中甲-2 的剩余圈数为 1。

## 快速启动

```bash
cd SilkReel/SilkReel-01
docker compose up --build
```
