/**
 * A value the surroundings were supposed to supply.
 *
 * Absent and empty are the same failure here: an unset repository variable arrives as
 * an empty string rather than as nothing, and an empty hostname would otherwise be
 * carried all the way to a request for `https:///`.
 */
export const requireEnvironment = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }

  return value;
};
