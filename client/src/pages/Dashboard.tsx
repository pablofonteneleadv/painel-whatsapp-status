import { Redirect } from "wouter";

/**
 * The scaffold's demo page (/dashboard, backed by the sample `items` router) is
 * no longer part of this app: the panel's home is the overview at `/`.
 *
 * Kept as a redirect rather than deleted so an old bookmark still lands
 * somewhere useful, and so the file tree holds no reference to a router that no
 * longer exists.
 */
export default function Dashboard() {
  return <Redirect to="/" />;
}
