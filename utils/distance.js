// helpers/distance.js
function toRad(v) {
  return (v * Math.PI) / 180;
}

// Returns distance in km (or meters if opts.meters = true)
module.exports = function distance(lat1, lon1, lat2, lon2, opts = {}) {
  if (
    [lat1, lon1, lat2, lon2].some(
      (v) => v === undefined || v === null || isNaN(Number(v))
    )
  )
    return 0;

  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R * c;

  if (opts.meters) return Math.round(km * 1000);
  return Math.round(km * 1000) / 1000;
};
