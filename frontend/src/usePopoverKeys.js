import { useEffect, useContext, createContext } from "react";

const PopoverActionsContext = createContext(null);

function usePopoverKeys(actions) {
  const registry = useContext(PopoverActionsContext);

  useEffect(() => {
    if (!registry) return;
    const keys = Object.keys(actions);
    for (const k of keys) registry.current[k] = actions[k];
    return () => {
      for (const k of keys) delete registry.current[k];
    };
  }, [registry, ...Object.values(actions)]);
}

export { PopoverActionsContext };
export default usePopoverKeys;
