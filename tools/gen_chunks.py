"""The chunks themselves: four biomes of eight floors, painted on a grid.

This is the file you edit to add a floor. The grid, the climbability rules and
the checks that enforce them are in `chunklib.py`.

Usage: python3 tools/gen_chunks.py packages/core/src/chunks.ts
"""
import io, os, sys

# `npm run levels` invokes this from the repo root, so the painter next door is
# not on the path by default.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chunklib import (
    BOT_C0, BOT_C1, HI, LO, MIN_LAUNCH_COLUMNS, TOP_C0, TOP_C1, W,
    C, launch_columns, overlap, reachable, seam_rows, solve_column,
)

chunks = []

# ===================================================== BIOME 0 — THE YARD ====
# A scaffolded builder's yard. Wide ledges, forgiving gaps, and the first
# lessons in what the rope does to you.
c = C('yard_start', 0, 0, 33, tags=['start'])
c.climb(width=13, step=(8, 4), direction=1)
c.put(2, 19, '!')
c.fill(30, 32, 2, 37, '#')
c.put(29, 19, 'S')
c.underhang(6, length=2)
chunks.append(c.check(is_start=True))

c = C('yard_ladders', 0, 0, 33)
c.climb(width=11, step=7, direction=-1)
c.put(2, 19, '!')
c.col(2, 5, 27, '*').col(37, 5, 27, '*')
c.restyle([3, 6], '=')
c.hazard(4, '^', side=1, length=2).underhang(7, length=2)
chunks.append(c.check())

c = C('yard_swing', 0, 1, 33)
c.climb(width=16, step=(10, 5), direction=1, start=6)
c.put(2, 19, '!')
c.col(2, 6, 24, '*').col(37, 6, 24, '*')
c.wall_spikes(11, -1, 2).wall_spikes(17, 1, 2)
c.spurs([2, 5, 8], side=1, length=5, gap=2)
c.hazard(3, '^', side=-1, length=3).hazard(6, '^', side=1, length=3)
c.underhang(8, length=3)
chunks.append(c.check())

c = C('yard_crates', 0, 0, 33)
c.climb(width=10, step=6, direction=1, start=22)
c.put(2, 19, '!')
c.deco(11, 4, 'xxxx').deco(20, 30, 'xxxx').deco(26, 6, 'xxx')
c.wall_spikes(14, 1, 3)
c.spurs([1, 4, 7, 10], side=-1, length=4, gap=3)
c.hazard(5, '^', side=1, length=2).underhang(2, length=2)
chunks.append(c.check())

c = C('yard_bounce', 0, 1, 33)
c.climb(width=12, step=(7, 4), direction=1)
c.put(2, 19, '!')
c.deco(24, 4, 'oooo').deco(15, 32, 'ooo')
c.deco(5, 14, 'vvvvvvvv')
c.hazard(2, '^', side=1, length=2).hazard(7, '^', side=-1, length=2)
c.underhang(5, length=3)
chunks.append(c.check())

c = C('yard_saw', 0, 1, 33)
c.climb(width=14, step=9, direction=-1, start=8)
c.put(2, 19, '!')
c.saw(x=8, y=13, r=1, ax=22, ay=0, period=200)
c.saw(x=30, y=22, r=1, ax=-20, ay=0, period=230, phase=60)
c.wall_spikes(8, -1, 2)
c.hazard(4, '^', side=-1, length=3).underhang(6, side=-1, length=3)
c.sweep(4, period=240)
c.gate(3)
chunks.append(c.check())

c = C('yard_gantry', 0, 1, 33)
c.climb(width=15, step=9, direction=-1, start=18)
c.put(2, 19, '!')
c.spurs([2, 5, 8, 11], side=1, length=6, gap=1, drop=1)
c.deco(14, 4, 'xxxx').deco(23, 31, 'xxx')
c.hazard(3, '^', side=1, length=3).underhang(6, length=3)
c.sweep(5, period=250)
chunks.append(c.check())

c = C('yard_narrow', 0, 1, 33)
c.climb(width=10, step=7, direction=1, start=26)
c.put(2, 19, '!')
c.col(2, 6, 27, '*').col(37, 6, 27, '*')
c.wall_spikes(13, 1, 3).wall_spikes(20, -1, 3)
c.hazard(2, '^', side=-1, length=2).hazard(7, '^', side=1, length=2)
c.underhang(4, length=3)
chunks.append(c.check())

c = C('yard_shift', 0, 0, 33)
c.climb(width=12, step=(8, 3), direction=-1)
c.put(2, 19, '!')
c.deco(9, 30, 'oooo').deco(19, 4, 'ooo')
c.underhang(3, length=2).underhang(7, side=-1, length=2)
chunks.append(c.check())

# ================================================== BIOME 1 — THE FOUNDRY ====
# Heat, moving metal, and machinery that pushes you toward the heat.
c = C('foundry_lava', 1, 1, 33)
c.climb(width=11, step=(7, 3), direction=1)
c.put(2, 19, '!')
c.ledge(26, 2, 5, '#', '~').ledge(20, 33, 5, '#', '~').ledge(11, 2, 4, '#', '~')
c.wall_spikes(23, 1, 2)
c.hazard(3, '^', side=1, length=3).underhang(5, length=3).underhang(8, side=-1, length=2)
c.sweep(6, period=220)
chunks.append(c.check())

c = C('foundry_conveyor', 1, 2, 33)
c.climb(width=13, step=8, direction=-1, start=20)
c.put(2, 19, '!')
c.deco(23, 4, 'ccccc').deco(14, 30, 'CCCCC')
c.ledge(24, 32, 5, '#', '~')
c.restyle([4, 7], 'c')
c.hazard(2, '^', side=-1, length=3).underhang(6, length=3)
c.crusher(8, period=180)
chunks.append(c.check())

c = C('foundry_press', 1, 2, 33)
c.climb(width=10, step=(6, 3), direction=1)
c.put(2, 19, '!')
c.mover(x=4, y=8, w=4, h=3, ax=0, ay=6, period=170, deadly=True)
c.mover(x=31, y=17, w=4, h=3, ax=0, ay=6, period=190, phase=70, deadly=True)
c.ledge(28, 2, 4, '#', '~')
c.hazard(3, '^', side=1, length=2).hazard(7, '^', side=-1, length=2)
c.underhang(5, length=3).underhang(9, side=-1, length=2)
c.sweep(3, period=200, phase=60)
c.gate(5)
chunks.append(c.check())

c = C('foundry_saws', 1, 2, 33)
c.climb(width=16, step=10, direction=1, start=5)
c.put(2, 19, '!')
c.saw(x=10, y=9, r=1, ax=0, ay=9, period=160)
c.saw(x=28, y=15, r=1, ax=0, ay=9, period=160, phase=80)
c.wall_spikes(20, -1, 2)
c.spurs([3, 6], side=-1, length=6, gap=2, drop=2)
c.hazard(2, '^', side=1, length=4).hazard(8, '^', side=-1, length=4)
c.underhang(5, length=4)
c.crusher(6, period=170)
chunks.append(c.check())

c = C('foundry_moving', 1, 2, 33)
c.climb(width=12, step=7, direction=-1)
c.put(2, 19, '!')
c.mover(x=8, y=12, w=5, h=1, ax=18, ay=0, period=240)
c.mover(x=26, y=21, w=5, h=1, ax=-16, ay=0, period=240, phase=120)
c.ledge(27, 33, 4, '#', '~')
c.restyle([3, 6], 'C')
c.hazard(8, '^', side=1, length=3).underhang(4, side=-1, length=3)
c.sweep(2, period=205)
chunks.append(c.check())

c = C('foundry_ladle', 1, 2, 33)
c.climb(width=15, step=(9, 5), direction=1, start=4)
c.put(2, 19, '!')
c.ledge(25, 2, 5, '#', '~').ledge(16, 33, 5, '#', '~')
c.restyle([5], 'c')
c.hazard(2, '^', side=1, length=3).underhang(7, side=-1, length=3)
c.crusher(4, period=175)
chunks.append(c.check())

c = C('foundry_belt', 1, 3, 33)
c.climb(width=13, step=(8, 4), direction=-1, start=22)
c.put(2, 19, '!')
c.restyle([2, 6], 'c')
c.mover(x=6, y=10, w=5, h=1, ax=20, ay=0, period=210)
c.mover(x=28, y=19, w=5, h=1, ax=-18, ay=0, period=230, phase=100)
c.hazard(4, '^', side=-1, length=3).underhang(8, length=3)
c.sweep(6, period=195)
c.gate(4)
chunks.append(c.check())

c = C('foundry_pour', 1, 2, 33)
c.climb(width=11, step=(7, 4), direction=1, start=9)
c.put(2, 19, '!')
c.ledge(12, 2, 4, '#', '~').ledge(21, 34, 4, '#', '~').ledge(29, 2, 4, '#', '~')
c.wall_spikes(17, 1, 2)
c.underhang(3, length=3).underhang(7, side=-1, length=2)
c.sweep(5, period=185, phase=40)
chunks.append(c.check())

# ================================================== BIOME 2 — THE FREEZER ====
# No friction, no mercy, and a wind with opinions about where you land.
c = C('freeze_ice', 2, 2, 33)
c.climb(width=14, step=(9, 4), direction=1, start=19)
c.put(2, 19, '!')
c.restyle([1, 2, 4, 5, 7, 8], 'i')
c.wall_spikes(19, 1, 3)
c.hazard(3, '^', side=1, length=3).hazard(6, '^', side=-1, length=3)
c.underhang(8, length=3)
chunks.append(c.check())

c = C('freeze_wind', 2, 2, 33)
c.climb(width=13, step=8, direction=-1)
c.put(2, 19, '!')
c.col(3, 6, 27, 'W').col(36, 6, 27, 'W')
c.deco(5, 13, 'vvvvvv').deco(5, 23, 'vvvv')
c.hazard(4, '^', side=-1, length=3).underhang(2, length=3).underhang(7, side=-1, length=3)
c.sweep(5, period=210, phase=70)
chunks.append(c.check())

c = C('freeze_crumble', 2, 3, 33)
c.climb(width=11, step=(7, 4), direction=-1, start=24)
c.put(2, 19, '!')
c.restyle([1, 3, 5, 7], 'i')
c.deco(9, 4, 'xxxx').deco(18, 30, 'xxxx').deco(24, 6, 'xxx')
c.col(2, 6, 26, '*').col(37, 6, 26, '*')
c.wall_spikes(12, -1, 2)
c.hazard(2, '^', side=1, length=3).hazard(6, '^', side=-1, length=3)
c.underhang(4, length=3).underhang(8, side=-1, length=3)
c.sweep(7, period=195, side=-1)
c.gate(4)
chunks.append(c.check())

c = C('freeze_saws', 2, 3, 33)
c.climb(width=16, step=(10, 6), direction=-1)
c.put(2, 19, '!')
c.restyle([1, 3, 5, 7], 'i')
c.saw(x=19, y=11, r=1, ax=14, ay=0, period=190)
c.saw(x=9, y=20, r=1, ax=0, ay=6, period=140, phase=40)
c.hazard(2, '^', side=-1, length=4).hazard(6, '^', side=1, length=4)
c.underhang(4, length=4).underhang(8, side=-1, length=3)
chunks.append(c.check())

c = C('freeze_pit', 2, 3, 33)
c.climb(width=10, step=6, direction=1, start=5)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.wall_spikes(10, 1, 2).wall_spikes(22, -1, 2)
c.deco(16, 4, 'xxxx').deco(24, 30, 'xxx')
c.spurs([2, 6], side=1, length=7, gap=1, drop=2)
c.hazard(3, '^', side=1, length=3).hazard(7, '^', side=-1, length=3)
c.underhang(5, length=3).underhang(9, side=-1, length=2)
c.sweep(4, period=190)
chunks.append(c.check())

c = C('freeze_glass', 2, 3, 33)
c.climb(width=15, step=(9, 5), direction=1, start=5)
c.put(2, 19, '!')
c.restyle([2, 4, 6, 8], 'i')
c.col(3, 7, 26, 'W').col(36, 7, 26, 'W')
c.hazard(3, '^', side=1, length=3).underhang(7, length=3)
chunks.append(c.check())

c = C('freeze_drift', 2, 2, 33)
c.climb(width=12, step=(7, 4), direction=-1, start=23)
c.put(2, 19, '!')
c.restyle([3, 7], 'i')
c.deco(11, 4, 'xxxx').deco(22, 30, 'xxxx')
c.wall_spikes(15, -1, 3)
c.underhang(5, length=3)
c.sweep(2, period=200)
c.gate(6)
chunks.append(c.check())

c = C('freeze_hang', 2, 3, 33)
c.climb(width=10, step=6, direction=1, start=27)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.restyle([2, 5], 'i')
c.hazard(3, '^', side=-1, length=2).hazard(7, '^', side=1, length=2)
c.underhang(5, length=3)
chunks.append(c.check())

# ==================================================== BIOME 3 — THE SPIRE ====
# Everything at once, at the top of the world, with the wind in your teeth.
c = C('spire_gauntlet', 3, 3, 33)
c.climb(width=12, step=(7, 3), direction=-1, start=21)
c.put(2, 19, '!')
c.restyle([4], 'i')
c.deco(12, 4, 'xxxx').deco(22, 30, 'xxx')
c.saw(x=19, y=16, r=1, ax=0, ay=7, period=130)
c.col(3, 18, 28, 'W').col(36, 18, 28, 'W')
c.wall_spikes(9, -1, 2)
c.restyle([5], 'c')
c.hazard(2, '^', side=1, length=3).hazard(6, '^', side=-1, length=3)
c.underhang(4, length=3).underhang(8, side=-1, length=3)
c.sweep(2, period=180).crusher(6, period=165)
chunks.append(c.check())

c = C('spire_crushers', 3, 3, 33)
c.climb(width=14, step=9, direction=-1)
c.put(2, 19, '!')
c.mover(x=6, y=7, w=4, h=3, ax=0, ay=7, period=140, deadly=True)
c.mover(x=29, y=7, w=4, h=3, ax=0, ay=7, period=140, phase=70, deadly=True)
c.saw(x=19, y=23, r=1, ax=0, ay=5, period=120)
c.ledge(28, 2, 4, '#', '~').ledge(28, 33, 4, '#', '~')
c.hazard(3, '^', side=-1, length=4).hazard(7, '^', side=1, length=4)
c.underhang(5, length=4).underhang(9, side=-1, length=3)
c.sweep(3, period=175).sweep(8, period=185, side=-1, phase=70)
chunks.append(c.check())

c = C('spire_final', 3, 3, 33)
c.climb(width=11, step=(7, 5), direction=1, start=7)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.deco(20, 32, 'ooo')
c.deco(10, 4, 'xxxx').deco(19, 30, 'xxx')
c.saw(x=8, y=12, r=1, ax=24, ay=0, period=150)
c.saw(x=19, y=25, r=1, ax=0, ay=4, period=110)
c.wall_spikes(18, 1, 2)
c.restyle([3], 'i')
c.hazard(2, '^', side=1, length=3).hazard(5, '^', side=-1, length=3)
c.hazard(8, '^', side=1, length=3).underhang(6, length=4)
c.sweep(2, period=170).crusher(5, period=160, side=-1)
c.gate(6)
chunks.append(c.check())

c = C('spire_mast', 3, 3, 33)
c.climb(width=13, step=(8, 5), direction=-1, start=20)
c.put(2, 19, '!')
c.col(3, 6, 28, 'W').col(36, 6, 28, 'W')
c.restyle([4], 'i')
c.deco(14, 4, 'xxx').deco(24, 31, 'xxx')
c.hazard(2, '^', side=1, length=3).underhang(6, length=4)
c.sweep(4, period=165).crusher(8, period=155)
chunks.append(c.check())

c = C('spire_wire', 3, 3, 33)
c.climb(width=16, step=(10, 6), direction=1, start=5)
c.put(2, 19, '!')
c.saw(x=19, y=9, r=1, ax=0, ay=8, period=140)
c.saw(x=10, y=24, r=1, ax=16, ay=0, period=160, phase=50)
c.wall_spikes(19, -1, 2).wall_spikes(26, 1, 2)
c.underhang(4, length=4).underhang(8, side=-1, length=3)
c.sweep(2, period=160)
c.gate(5)
chunks.append(c.check())

c = C('spire_lastlift', 3, 3, 33)
c.climb(width=11, step=(7, 3), direction=-1, start=24)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.mover(x=5, y=9, w=4, h=3, ax=0, ay=6, period=145, deadly=True)
c.mover(x=30, y=20, w=4, h=3, ax=0, ay=6, period=150, phase=70, deadly=True)
c.hazard(3, '^', side=1, length=3).hazard(7, '^', side=-1, length=3)
c.underhang(5, length=3)
c.sweep(9, period=170)
chunks.append(c.check())

# ============================================ GAUNTLET-ONLY — THE BACK LOT ====
# Twenty rooms the campaign never opens.
#
# `buildCampaign` used to be handed `CHUNKS` — the entire library, in library
# order — so one playthrough of The Long Haul showed a player every room in the
# game and the Gauntlet was a reshuffle of floors they had already climbed.
# There was nothing left for a second evening to be about. These are tagged
# `spare` and the campaign filters them out, so the endless tower and the daily
# have somewhere to draw a floor nobody has seen.
#
# They also break the library out of one silhouette. The campaign's rooms are
# all 33 rows; these run from 24 to 41, so a tower assembled from them has an
# irregular rhythm instead of a metronome.

c = C('yard_hoist', 0, 1, 30, tags=['spare'])
c.climb(width=12, step=(7, 4), direction=-1, start=24)
c.put(2, 19, '!')
c.col(2, 6, 22, '*')
c.mover(x=14, y=6, w=5, h=1, ax=9, ay=0, period=210)
c.restyle([2, 5], '=')
c.hazard(3, '^', side=1, length=3).underhang(6, length=3)
chunks.append(c.check())

c = C('yard_scaffold', 0, 1, 36, tags=['spare'])
c.climb(width=9, step=5, direction=1, start=8)
c.put(2, 19, '!')
c.spurs([2, 5, 8], side=-1, length=4, gap=3)
c.wall_spikes(14, 1, 3)
c.hazard(4, '^', side=-1, length=2).hazard(9, '^', side=1, length=2)
c.underhang(7, length=3)
chunks.append(c.check())

c = C('yard_dropoff', 0, 2, 33, tags=['spare'])
c.climb(width=14, step=(9, 5), direction=1)
c.put(2, 19, '!')
c.ledge(24, 2, 6, '#')
c.saw(x=20, y=14, r=1, ax=11, ay=0, period=200)
c.hazard(2, '^', side=1, length=3)
c.underhang(5, length=4).underhang(8, side=-1, length=2)
c.gate(4)
chunks.append(c.check())

c = C('yard_gully', 0, 1, 30, tags=['spare'])
c.climb(width=10, step=6, direction=-1, start=26)
c.put(2, 19, '!')
c.col(37, 5, 25, '*')
c.restyle([1, 4, 7], '=')
c.hazard(3, '^', side=-1, length=3).hazard(6, '^', side=1, length=2)
c.underhang(5, length=3)
chunks.append(c.check())

c = C('yard_stack', 0, 0, 27, tags=['spare'])
c.climb(width=15, step=(10, 4), direction=1, start=5)
c.put(2, 19, '!')
c.deco(20, 6, '::::')
c.spurs([1, 4], side=1, length=5, gap=2)
c.hazard(3, '^', side=1, length=2)
c.underhang(4, length=3)
chunks.append(c.check())

c = C('foundry_ingot', 1, 2, 36, tags=['spare'])
c.climb(width=11, step=7, direction=1, start=6)
c.put(2, 19, '!')
c.ledge(28, 32, 5, '#', '~').ledge(18, 2, 5, '#', '~')
c.crusher(5, period=190, phase=40)
c.hazard(2, '^', side=1, length=3).hazard(7, '^', side=-1, length=3)
c.underhang(4, length=3)
chunks.append(c.check())

c = C('foundry_flue', 1, 3, 30, tags=['spare'])
c.climb(width=13, step=(8, 4), direction=-1, start=22)
c.put(2, 19, '!')
c.saw(x=8, y=7, r=1, ax=0, ay=8, period=150)
c.saw(x=30, y=16, r=1, ax=0, ay=8, period=150, phase=75)
c.wall_spikes(18, -1, 2)
c.hazard(3, '^', side=1, length=3)
c.underhang(5, length=3)
c.gate(2)
chunks.append(c.check())

c = C('foundry_slag', 1, 2, 39, tags=['spare'])
c.climb(width=10, step=6, direction=1)
c.put(2, 19, '!')
c.ledge(34, 2, 6, '#', '~').ledge(22, 31, 6, '#', '~').ledge(12, 2, 5, '#', '~')
c.restyle([3, 8], 'c')
c.hazard(5, '^', side=-1, length=3).hazard(10, '^', side=1, length=2)
c.underhang(7, length=4)
chunks.append(c.check())

c = C('foundry_tap', 1, 3, 33, tags=['spare'])
c.climb(width=16, step=10, direction=-1, start=20)
c.put(2, 19, '!')
c.mover(x=6, y=10, w=4, h=3, ax=0, ay=7, period=160, deadly=True)
c.sweep(4, period=210, phase=30)
c.hazard(2, '^', side=-1, length=4).hazard(6, '^', side=1, length=3)
c.underhang(5, length=4)
chunks.append(c.check())

c = C('foundry_gantry', 1, 2, 24, tags=['spare'])
c.climb(width=12, step=(7, 5), direction=1, start=7)
c.put(2, 19, '!')
c.mover(x=12, y=8, w=6, h=1, ax=12, ay=0, period=230)
c.ledge(20, 33, 5, '#', '~')
c.hazard(2, '^', side=1, length=3)
c.underhang(4, length=2)
chunks.append(c.check())

c = C('freeze_shelf', 2, 3, 30, tags=['spare'])
c.climb(width=11, step=7, direction=1, start=9)
c.put(2, 19, '!')
c.restyle([2, 5, 8], 'i')
c.wall_spikes(16, 1, 3)
c.hazard(3, '^', side=-1, length=3)
c.underhang(6, length=3)
chunks.append(c.check())

c = C('freeze_calving', 2, 3, 36, tags=['spare'])
c.climb(width=14, step=(9, 4), direction=-1, start=24)
c.put(2, 19, '!')
c.restyle([1, 6], 'i')
c.saw(x=22, y=18, r=1, ax=10, ay=0, period=190)
c.hazard(4, '^', side=1, length=3).hazard(9, '^', side=-1, length=2)
c.underhang(7, length=3)
c.gate(3)
chunks.append(c.check())

c = C('freeze_lantern', 2, 2, 27, tags=['spare'])
c.climb(width=13, step=8, direction=1, start=6)
c.put(2, 19, '!')
c.col(2, 5, 21, '*')
c.restyle([3], 'i')
c.hazard(1, '^', side=1, length=2).hazard(4, '^', side=-1, length=2)
c.underhang(3, length=3)
chunks.append(c.check())

c = C('freeze_rime', 2, 3, 36, tags=['spare'])
c.climb(width=9, step=5, direction=-1, start=28)
c.put(2, 19, '!')
c.restyle([2, 7], 'i')
c.spurs([4, 8], side=1, length=4, gap=3)
c.hazard(5, '^', side=-1, length=2)
c.underhang(6, length=3)
chunks.append(c.check())

c = C('freeze_crevasse', 2, 3, 33, tags=['spare'])
c.climb(width=15, step=(10, 5), direction=1, start=5)
c.put(2, 19, '!')
c.restyle([2, 6], 'i')
c.mover(x=16, y=14, w=5, h=1, ax=10, ay=0, period=200)
c.hazard(3, '^', side=1, length=3).hazard(7, '^', side=-1, length=3)
c.underhang(5, length=4)
chunks.append(c.check())

c = C('spire_aerial', 3, 3, 30, tags=['spare'])
c.climb(width=10, step=6, direction=1, start=23)
c.put(2, 19, '!')
c.col(37, 5, 23, '*')
c.saw(x=26, y=10, r=1, ax=0, ay=8, period=170)
c.hazard(2, '^', side=-1, length=3)
c.underhang(5, length=3)
chunks.append(c.check())

c = C('spire_derrick', 3, 3, 42, tags=['spare'])
c.climb(width=12, step=(7, 4), direction=-1, start=20)
c.put(2, 19, '!')
c.spurs([3, 7, 11], side=-1, length=4, gap=3)
c.wall_spikes(24, 1, 3)
c.hazard(5, '^', side=1, length=3).hazard(10, '^', side=-1, length=3)
c.underhang(8, length=3)
c.gate(6)
chunks.append(c.check())

c = C('spire_pylon', 3, 3, 33, tags=['spare'])
c.climb(width=13, step=8, direction=1, start=7)
c.put(2, 19, '!')
c.mover(x=10, y=12, w=5, h=1, ax=14, ay=0, period=240)
c.hazard(3, '^', side=1, length=3).hazard(6, '^', side=-1, length=2)
c.underhang(4, length=3)
chunks.append(c.check())

c = C('spire_beacon', 3, 3, 24, tags=['spare'])
c.climb(width=11, step=(7, 5), direction=-1, start=18)
c.put(2, 19, '!')
c.saw(x=14, y=9, r=1, ax=9, ay=0, period=160)
c.hazard(2, '^', side=-1, length=2)
c.underhang(3, length=2)
chunks.append(c.check())

c = C('spire_topout', 3, 3, 36, tags=['spare'])
c.climb(width=14, step=9, direction=1, start=6)
c.put(2, 19, '!')
c.spurs([2, 6], side=1, length=5, gap=2, drop=2)
c.saw(x=8, y=20, r=1, ax=0, ay=9, period=150, phase=60)
c.hazard(4, '^', side=-1, length=3).hazard(8, '^', side=1, length=3)
c.underhang(6, length=4)
chunks.append(c.check())

c = C('spire_goal', 3, 0, 24, tags=['goal'])
c.climb(width=13, step=(8, 5), direction=1)
c.fill(0, 1, 2, 37, '#')
c.put(2, 17, 'FFFFFF')
c.put(5, 19, '!')
c.underhang(3, length=3)
chunks.append(c.check(is_goal=True))

out = io.StringIO()
out.write("""import type { ChunkDef } from './level.js';

/**
 * Hand-authored chunks, generated by tools/gen_chunks.py.
 *
 * Every chunk is 40 tiles wide with solid side walls, and carries a landing
 * platform at local row 1 and another at row h-2. Stacked, those land exactly
 * three rows apart with clear rows between them, so any chunk can follow any
 * other and the seam is always jumpable. Inside a chunk the route is a
 * serpentine whose footholds are never more than three rows and three columns
 * apart — one jump. `scripts/verify-levels.mjs` re-derives all of this from the
 * assembled level and fails the build if it stops holding.
 */
export const CHUNKS: ChunkDef[] = [
""")
out.write(',\n'.join(ch.emit() for ch in chunks))
out.write(",\n];\n\nexport const BIOME_NAMES = ['THE YARD', 'THE FOUNDRY', 'THE FREEZER', 'THE SPIRE'];\n")
out.write("""
/** The campaign, in order, bottom to top. */
export const CAMPAIGN_CHUNK_IDS = [
""")
out.write('\n'.join(f"  '{ch.id}'," for ch in chunks))
out.write("\n];\n")

cleared = [(ch.id, why) for ch in chunks for why in ch.cleared]
if cleared:
    print(f'{len(cleared)} entit(y/ies) lifted out of a gate\'s airspace:')
    for cid, why in cleared:
        print(f'  {cid}: {why}')

moved = [(ch.id, why) for ch in chunks for why in ch.moved]
if moved:
    print(f'{len(moved)} hazard(s) went to a neighbouring step:')
    for cid, why in moved:
        print(f'  {cid}: {why}')

# A hazard the author asked for and the generator could not place is the level
# quietly disagreeing with its own design, and it is invisible: the chunk still
# compiles, the tower is still climbable, and the step the design wanted
# dangerous is a step you stroll across. Thirty of them accumulated while this
# was a printed line nobody read. It is the build now.
skipped = [(ch.id, why) for ch in chunks for why in ch.skipped]
if skipped:
    print(f'{len(skipped)} hazard(s) had nowhere to go:')
    for cid, why in skipped:
        print(f'  {cid}: {why}')
    sys.exit(1)

if len(sys.argv) < 2:
    sys.exit('usage: gen_chunks.py <output path>')
path = sys.argv[1]
open(path, 'w').write(out.getvalue())
print(f'wrote {len(chunks)} chunks, {sum(ch.h for ch in chunks)} rows -> {path}')
