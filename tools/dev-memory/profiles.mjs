/**
 * WorkBuddy low-memory task profiles.
 *
 * The values are conservative defaults from ARCHITECTURE_v0.0.21 §1.2.2 and
 * must be calibrated against real before/after measurements before claiming a
 * minimum supported machine size.
 */

/** @typedef {'next-dev'|'next-build'|'vitest'|'playwright'|'visual-audit'} ProfileName */

export const PROFILES = Object.freeze({
  'next-dev': Object.freeze({
    taskShare: 0.4,
    taskFloorMB: 384,
    nodeHeapRatio: 0.6,
  }),
  'next-build': Object.freeze({
    taskShare: 0.55,
    taskFloorMB: 768,
    nodeHeapRatio: 0.6,
  }),
  vitest: Object.freeze({
    taskShare: 0.35,
    taskFloorMB: 384,
    nodeHeapRatio: 0.6,
  }),
  playwright: Object.freeze({
    taskShare: 0.45,
    taskFloorMB: 512,
    nodeHeapRatio: 0.6,
  }),
  'visual-audit': Object.freeze({
    taskShare: 0.45,
    taskFloorMB: 512,
    nodeHeapRatio: 0.6,
  }),
});

export const PROFILE_NAMES = Object.freeze(Object.keys(PROFILES));

/**
 * Return a validated profile definition.
 *
 * @param {string} name
 * @returns {Readonly<{taskShare:number, taskFloorMB:number, nodeHeapRatio:number}>}
 */
export function getProfile(name) {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) {
    throw new Error(`unknown profile: ${name}; expected one of ${PROFILE_NAMES.join(', ')}`);
  }
  return PROFILES[/** @type {ProfileName} */ (name)];
}
