// Composer-parity z-index ladder (#61 / #65): the minimal set of tiers the
// overlay stack needs. Kept monotonic — modal sits below toast, which sits
// below tooltip (tooltip is always-on-top so it clears any anchor, including
// one inside a modal or toast). New overlay tiers extend this object, not a
// parallel constant.
export const Z_INDEX = {
  modal: 500,
  toast: 600,
  tooltip: 10000,
} as const;
