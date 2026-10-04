from __future__ import annotations

from collections import deque


# خوارزمية BFS يدوية للبحث عن أقصر مسار على شبكة 40x40
# العوائق: tile.type == 1 (water)
def bfs_find_path(
    grid: list[list[object]],
    start: tuple[int, int],
    target_condition,
    grid_size: int,
) -> list[tuple[int, int]] | None:
    sx, sy = start
    if not (0 <= sx < grid_size and 0 <= sy < grid_size):
        return None

    visited = [[False] * grid_size for _ in range(grid_size)]
    parent: dict[tuple[int, int], tuple[int, int] | None] = {}
    queue: deque[tuple[int, int]] = deque()

    queue.append((sx, sy))
    visited[sy][sx] = True
    parent[(sx, sy)] = None

    directions = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    found: tuple[int, int] | None = None

    while queue:
        x, y = queue.popleft()
        tile = grid[y][x]

        if target_condition(x, y, tile):
            found = (x, y)
            break

        for dx, dy in directions:
            nx, ny = x + dx, y + dy
            if 0 <= nx < grid_size and 0 <= ny < grid_size and not visited[ny][nx]:
                neighbor = grid[ny][nx]
                if not getattr(neighbor, "type", 0) == 1:
                    visited[ny][nx] = True
                    parent[(nx, ny)] = (x, y)
                    queue.append((nx, ny))

    if found is None:
        return None

    path: list[tuple[int, int]] = []
    current: tuple[int, int] | None = found
    while current is not None:
        path.append(current)
        current = parent[current]

    path.reverse()
    if len(path) <= 1:
        return path
    return path[1:]


# إرجاع الخطوة التالية فقط
def bfs_next_step(
    grid: list[list[object]],
    start: tuple[int, int],
    target_condition,
    grid_size: int,
) -> tuple[int, int] | None:
    path = bfs_find_path(grid, start, target_condition, grid_size)
    if not path:
        return None
    return path[0]
