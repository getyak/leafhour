// Exact solution for a unit-mass spring: frame intervals change sampling,
// rather than changing the motion or dropping elapsed time.
export function advanceSpring({ position, velocity }, target, seconds) {
  if (seconds <= 0) return { position, velocity };
  const stiffness = 390;
  const decay = 18;
  const frequency = Math.sqrt(stiffness - decay * decay);
  const displacement = position - target;
  const envelope = Math.exp(-decay * seconds);
  const cosine = Math.cos(frequency * seconds);
  const sine = Math.sin(frequency * seconds);
  return {
    position: target + envelope * (displacement * cosine + (velocity + decay * displacement) / frequency * sine),
    velocity: envelope * (velocity * cosine - (decay * velocity + stiffness * displacement) / frequency * sine),
  };
}

export function resistedPosition(value, min, max, extent) {
  if (value >= min && value <= max) return value;
  const edge = value < min ? min : max;
  const distance = value - edge;
  const dimension = Math.max(1, extent);
  return edge + distance * dimension * 0.55 / (dimension + 0.55 * Math.abs(distance));
}

export function nearestDetent(position, velocity, stops) {
  // Exponential deceleration projects the release velocity into resting space.
  const projected = position + (velocity / 1000) * 0.998 / (1 - 0.998);
  return stops.reduce((nearest, stop) =>
    Math.abs(stop[1] - projected) < Math.abs(nearest[1] - projected) ? stop : nearest,
  )[0];
}
