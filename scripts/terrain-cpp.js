import { groundShader } from '../src/terrain.js';
import { ROUTES, SHAPES } from '../src/regions.js';

// Reuse the shader's arithmetic and expanded world data, restoring the CPU
// reference's bounds tests. GPU branches and CPU branches have different costs.
export function terrainCpp() {
  let source = groundShader;
  const replace = (pattern, replacement) => {
    const next = source.replace(pattern, replacement);
    if (next === source) throw new Error(`Terrain C++ generator no longer matches: ${pattern}`);
    source = next;
  };
  replace(/  float westCurve = ([^\n]+);/, `  float westCurve = z > ${SHAPES.westValley.head}. ? $1 : INFINITY;`);
  replace(/  float westOffset = ([^\n]+);/, `  float westOffset = abs(x - westCurve) < ${SHAPES.westValley.wall + 360}. ? $1 : INFINITY;`);
  replace(/  float plateauEdge = (.+) \+ (\(groundNoise[^\n]+);/, '  float plateauCore = $1;\n  float plateauEdge = plateauCore < 1.13 ? plateauCore + $2 : 2.;');
  const declarations = source.match(/  float cx = [^\n]+;\n  float corridorDetail = [^\n]+;/)?.[0];
  if (!declarations) throw new Error('Missing corridor coordinates');
  replace(declarations, `  float cx = 0., cz = 0., corridorDetail = 0.;
  bool corridorReady = false;
  auto prepareCorridor = [&]() {
    if (corridorReady) return;
    corridorReady = true;
${declarations.replace(/float /g, '')}
  };`);
  for (const outer of [false, true]) {
    const routes = ROUTES.filter(r => r.carve !== false && !!r.outer === outer);
    routes.forEach((r,i) => {
      const reach = r.width * 4 + 400, xs = r.points.map(p=>p[0]), zs = r.points.map(p=>p[1]);
      const call = `h = ground${outer ? 'OuterCorridor' : 'Corridor'}${i}(cx, cz, h, corridorDetail);`;
      replace(call, `if (x >= ${Math.min(...xs)-reach}. && x <= ${Math.max(...xs)+reach}. && z >= ${Math.min(...zs)-reach}. && z <= ${Math.max(...zs)+reach}.) { prepareCorridor(); ${call} }`);
    });
  }
  replace('  return mix(mix(ay, by, groundSmooth(0., 1., t)) + detail, h, groundSmooth(width * .5, width * 4., d));',
    '  if (d >= width * 4.) return h;\n  return mix(mix(ay, by, groundSmooth(0., 1., t)) + detail, h, groundSmooth(width * .5, width * 4., d));');
  // Only the main groundHeight function uses this basin expression.
  const start = source.indexOf('float groundHeight(float x, float z)');
  let body = source.slice(start);
  body = body.replace('    float bed =', '    if (e < 1.7) {\n    float bed =')
    .replace('h = mix(h, min(bed, h), (1. - groundSmooth(1.03, 1.7, e)) * basinNorth);',
      'h = mix(h, min(bed, h), (1. - groundSmooth(1.03, 1.7, e)) * basinNorth);\n    }');
  source = source.slice(0,start)+body;
  return source.replace(/\bfloat\b/g, 'double').replace(/\buint\b/g, 'uint32_t').replace(/\bint\(/g, 'int32_t(');
}
