import { useWorkspace } from "@/components/app/workspace-context";
import {
  presentationKey,
  startPresentation,
  stopPresentation,
  usePresentationActiveKey,
} from "@/lib/presentation-mode";

/**
 * Whether the illustrative showcase is on for the current user and organization.
 * `available`: only organizations classified as demo (organizations.is_demo) offer the showcase.
 * `active`: the user turned it on in this tab (off by default, never restored after a reload).
 */
export function usePresentationMode() {
  const { org, user } = useWorkspace();
  const activeKey = usePresentationActiveKey();
  const key = presentationKey(user.id, org.id);
  const available = org.fictional;
  return {
    available,
    active: available && activeKey === key,
    start: () => startPresentation(key),
    stop: stopPresentation,
  };
}
