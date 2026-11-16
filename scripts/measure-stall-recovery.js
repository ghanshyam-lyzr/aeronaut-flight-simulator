// Repeat the actual-controller, ordinary-input pilot used by the exercise regression tests. Gameplay, not flight data.
import { setup, flyRecovery } from '../tests/stall-recovery-pilot.js';
for (const rate of [30, 60, 144]) {
  const x = setup(); x.activities.startRecovery(x.flight);
  const r = flyRecovery(x, { rate });
  console.log(JSON.stringify({ fps: rate, status: r.status, stallSeen: r.stallSeen, stallAt: r.stall?.time,
    stallKnots: r.stall?.speed * 1.94384, recoverySeconds: r.result?.recoveryTime,
    heightLostMetres: r.result?.heightLost, minimumClearanceMetres: r.minClearance, final: r.final }));
}
