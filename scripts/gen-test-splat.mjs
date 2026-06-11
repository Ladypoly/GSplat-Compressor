// Generates a minimal but valid 3DGS PLY (SH band 0 only) for testing.
// Usage: node scripts/gen-test-splat.mjs <out.ply> [count]
import fs from 'node:fs';

const out = process.argv[2] || 'test.ply';
const N = Number(process.argv[3] || 2000);

const props = [
  'x', 'y', 'z',
  'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity',
  'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3'
];

let header = 'ply\nformat binary_little_endian 1.0\n';
header += `element vertex ${N}\n`;
for (const p of props) header += `property float ${p}\n`;
header += 'end_header\n';

const buf = Buffer.alloc(N * props.length * 4);
let o = 0;
// deterministic pseudo-random so output is reproducible
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
for (let i = 0; i < N; i++) {
  const vals = [
    (rnd() - 0.5) * 2, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2, // xyz in a cube
    rnd(), rnd(), rnd(),                                      // f_dc color
    2.0,                                                      // opacity (logit)
    -3, -3, -3,                                               // log scales (small)
    1, 0, 0, 0                                                // quaternion
  ];
  for (const v of vals) {
    buf.writeFloatLE(v, o);
    o += 4;
  }
}

fs.writeFileSync(out, Buffer.concat([Buffer.from(header, 'ascii'), buf]));
console.log(`wrote ${out}: ${N} splats, ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
