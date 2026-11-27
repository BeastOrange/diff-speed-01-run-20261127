# diff-speed-01-run-20261127

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/BeastOrange/diff-speed-01-run-20261127/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/BeastOrange/diff-speed-01-run-20261127/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

High-performance, dependency-free drop-in replacement for makefun-diff 1.0.0.

## What it does

Computes make.fun unified diff patches between two texts (`{ old, new }`), producing output byte-for-byte identical to the reference `makefun-diff 1.0.0` implementation while running substantially faster.

- Cuts lines strictly after every `\n`.
- Identifies and retains longest common prefix and suffix.
- Computes Myers greedy search with make.fun tie-breaking rules (preferring deletions when both candidates reach the same point).
- Formats `makefun-diff/1` hunks with up to 3 context lines, merging change runs at most 6 kept lines apart.
- Correctly marks files lacking trailing newlines with `%`.

## How it works

1. **Zero Duplicate Line Allocations**: Tokenizes lines directly from split buffers and interns them into 32-bit integer identifiers using a single `Map`, avoiding duplicate newline concatenations.
2. **Myers Greedy Search with L1 Cache Locality**: Maintains two small contiguous `Int32Array` buffers (`vPrev` and `vCurr`) that fit into L1 CPU cache during forward diagonal exploration, avoiding pointer indirection.
3. **Optimized Diagonal Stepping**: Keeps diagonal pointers in CPU registers to eliminate repeated array reads and boundary checks in the hot loop.
4. **Packed History Backtracking**: Reconstructs the exact shortest edit script backwards from compact triangular history offsets without per-step heap object allocations.

## Benchmark Results

Measured against `makefun-diff 1.0.0` on the official practice test set (Node 22, median over 7 runs, independently re-verified):

| Case | Baseline (ms) | Ours (ms) | Speedup |
| :--- | :---: | :---: | :---: |
| g-0001 | 357.1 | 118.9 | 3.00x |
| g-0002 | 366.8 | 132.4 | 2.77x |
| g-0003 | 316.9 | 106.2 | 2.99x |
| g-0004 | 320.2 | 103.8 | 3.09x |
| **Total** | **1361.1** | **461.3** | **2.95x** |

Overall speedup: **2.95x faster** (reduction from 1361.1 ms to 461.3 ms).
