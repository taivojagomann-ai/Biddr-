"use client";
import { useEffect, useState } from "react";
import { isCarMake } from "@/lib/data/car-makes";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Models already listed on Biddr for a make from the list, for the Model field's
 * suggestions (most used first). Empty for no make or an "Other" make.
 */
export function useModelSuggestions(make: string): string[] {
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    if (!isCarMake(make)) {
      setModels([]);
      return;
    }
    let cancelled = false;
    void getBrowserSupabase()
      .from("auctions")
      .select("model")
      .eq("make", make)
      .limit(500)
      .returns<{ model: string }[]>()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const counts = new Map<string, { label: string; n: number }>();
        for (const { model } of data) {
          const label = model?.trim();
          if (!label) continue;
          const key = label.toLowerCase();
          const seen = counts.get(key);
          if (seen) seen.n += 1;
          else counts.set(key, { label, n: 1 });
        }
        setModels(
          [...counts.values()]
            .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
            .slice(0, 50)
            .map((m) => m.label),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [make]);
  return models;
}
