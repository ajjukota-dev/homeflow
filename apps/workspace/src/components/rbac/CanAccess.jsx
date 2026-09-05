import { useCan } from "@/context/PermissionsContext";

/**
 * Gate any child element on matrix permission.
 *
 * <CanAccess module="collections" action="write">
 *   <Button>Record Payment</Button>
 * </CanAccess>
 *
 * If forbidden, renders `fallback` (default: null → element disappears).
 * Nested CanAccess short-circuits because `useCan` is O(1) map lookup.
 */
export default function CanAccess({ module, action = "read", fallback = null, children }) {
  const allowed = useCan(module, action);
  if (!allowed) return fallback;
  return children;
}
