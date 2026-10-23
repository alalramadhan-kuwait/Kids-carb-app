// What the server function needs from the app's engine. scripts/bundle-benchmark.mjs bundles this, with the very same
// src/engine files the app runs, into bench.js (generated: do not edit bench.js by hand).
export { benchmark, shadowNow, BENCH_VERSION, MODEL_VERSION, type BData, type BenchResult } from '../../../src/engine/benchmark';
export { isDrink } from '../../../src/engine/absorb';
