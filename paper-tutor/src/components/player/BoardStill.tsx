"use client";

import { useCallback } from "react";
import type { SceneList } from "@/lib/scenes/types";
import type { ThemeName } from "@/lib/types";
import { idToSlug } from "@/lib/arxivId";
import { Board } from "./Board";
import "./player.css";

// One scene of a scene list, fully drawn and still: a real frame from the player, used as a preview.
export function BoardStill({ list, scene, theme }: { list: SceneList; scene: number; theme: ThemeName }) {
  const steps = list.scenes[scene].draw.filter((s) => s.t !== "camera");
  const paper = list.paper ? idToSlug(list.paper) : null;
  const figureSrc = useCallback((fig: string) => (paper ? `/api/papers/${paper}/figures/${fig}` : null), [paper]);
  return (
    <div className={`player theme-${theme}`}>
      <div className="player-stage">
        <Board
          steps={steps}
          timings={steps.map(() => ({ start: 0, dur: 1, items: [0, 0, 0, 0, 0, 0, 0, 0] }))}
          time={1e6}
          base={[]}
          fading={[]}
          fade={0}
          prevCamera={[]}
          figureSrc={figureSrc}
          sceneKey={`still-${scene}`}
        />
      </div>
    </div>
  );
}
