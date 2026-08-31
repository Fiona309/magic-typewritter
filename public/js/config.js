export const CONFIG = {
  letters: {
    Q:[.183,.585], W:[.254,.585], E:[.326,.585], R:[.397,.585], T:[.467,.585],
    Y:[.538,.585], U:[.608,.585], I:[.679,.585], O:[.749,.585], P:[.818,.585],
    A:[.212,.686], S:[.289,.686], D:[.363,.686], F:[.437,.686], G:[.511,.686],
    H:[.585,.686], J:[.659,.686], K:[.733,.686], L:[.805,.686],
    Z:[.237,.802], X:[.316,.802], C:[.395,.802], V:[.474,.802], B:[.553,.802],
    N:[.632,.802], M:[.710,.802]
  },
  hover: { radius:.048, sticky:.62, smooth:.35 },
  hand: { pinchOn:.48, pinchOff:.72, indexCurl:1.45, fistOpen:1.35, thumbOpen:1.55, thumbLift:.28, thumbExt:1.05, scissorExtend:1.5, scissorCurl:1.35, scissorHold:.3, handsSeparate:.24, handsUpSustainMs:400, raiseY:.62, lostGraceMs:250 },
  gestures: { thumbCooldown:.9, handsUpHold:.6, handsUpGrace:.4 },
  limits: { name:15, creation:15 },
  timings: { posterHold:12, idleReset:55 }
};
