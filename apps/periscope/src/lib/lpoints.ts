/**
 * L-point coordinate computation for EVE Frontier solar systems.
 *
 * Lagrange points are computed from a planet's position relative to the sun at origin.
 * These are simplified ratios suitable for informational/UI purposes (populating
 * dropdown selectors and labels like "P2-L3"), not precise gravitational calculations.
 */

// ── Configurable L-point ratios ─────────────────────────────────────────────

export const L_POINT_RATIOS = {
	/** L1: fraction of orbital radius, sunward (between sun and planet) */
	L1: 0.85,
	/** L2: fraction of orbital radius, beyond planet */
	L2: 1.15,
	/** L3: opposite side of sun (negated planet vector, same distance) */
	L3: -1.0,
	/** L4: 60 degrees ahead of planet in orbital plane */
	L4_ANGLE: Math.PI / 3,
	/** L5: 60 degrees behind planet in orbital plane */
	L5_ANGLE: -Math.PI / 3,
};

type Vec3 = [number, number, number];

/**
 * Compute all 5 Lagrange points for a planet at (px, py, pz) relative to the sun at origin.
 *
 * @returns Object with L1..L5 coordinates as [x, y, z] tuples
 */
export function computeLPoints(px: number, py: number, pz: number): Record<string, Vec3> {
	// L1: between sun and planet
	const l1: Vec3 = [px * L_POINT_RATIOS.L1, py * L_POINT_RATIOS.L1, pz * L_POINT_RATIOS.L1];

	// L2: beyond planet
	const l2: Vec3 = [px * L_POINT_RATIOS.L2, py * L_POINT_RATIOS.L2, pz * L_POINT_RATIOS.L2];

	// L3: opposite side of sun
	const l3: Vec3 = [px * L_POINT_RATIOS.L3, py * L_POINT_RATIOS.L3, pz * L_POINT_RATIOS.L3];

	// L4 and L5: rotate planet vector +/-60 degrees in the orbital plane.
	// The orbital plane is defined by the sun-planet vector and a perpendicular.
	// We compute a perpendicular using cross product with a reference axis.
	const l4 = rotateAroundNormal(px, py, pz, L_POINT_RATIOS.L4_ANGLE);
	const l5 = rotateAroundNormal(px, py, pz, L_POINT_RATIOS.L5_ANGLE);

	return { L1: l1, L2: l2, L3: l3, L4: l4, L5: l5 };
}

/**
 * Rotate a vector (px, py, pz) by `angle` radians around a normal to the orbital plane.
 *
 * The orbital plane normal is derived from `cross(planet_pos, ref_axis)`.
 * Uses [0, 1, 0] as reference axis unless the planet is near the y-axis,
 * in which case [0, 0, 1] is used to avoid degeneracy.
 */
function rotateAroundNormal(px: number, py: number, pz: number, angle: number): Vec3 {
	// Choose a reference axis that isn't nearly parallel to the planet vector
	const len = Math.sqrt(px * px + py * py + pz * pz);
	if (len === 0) return [0, 0, 0];

	const nx = px / len;
	const ny = py / len;
	const nz = pz / len;

	// Reference axis: use Y-up unless planet is nearly along Y
	let rx = 0;
	let ry = 1;
	let rz = 0;
	if (Math.abs(ny) > 0.9) {
		rx = 0;
		ry = 0;
		rz = 1;
	}

	// Compute orbital plane normal: cross(planet_dir, ref_axis)
	let ax = ny * rz - nz * ry;
	let ay = nz * rx - nx * rz;
	let az = nx * ry - ny * rx;

	// Normalize the axis
	const alen = Math.sqrt(ax * ax + ay * ay + az * az);
	if (alen === 0) return [px, py, pz];
	ax /= alen;
	ay /= alen;
	az /= alen;

	// Rodrigues' rotation formula: v_rot = v*cos(a) + (k x v)*sin(a) + k*(k.v)*(1-cos(a))
	const cosA = Math.cos(angle);
	const sinA = Math.sin(angle);

	// k x v (cross product of axis and planet vector)
	const kxvX = ay * pz - az * py;
	const kxvY = az * px - ax * pz;
	const kxvZ = ax * py - ay * px;

	// k . v (dot product)
	const kdotv = ax * px + ay * py + az * pz;

	return [
		px * cosA + kxvX * sinA + ax * kdotv * (1 - cosA),
		py * cosA + kxvY * sinA + ay * kdotv * (1 - cosA),
		pz * cosA + kxvZ * sinA + az * kdotv * (1 - cosA),
	];
}
