/**
 * Feature layer entry: compare tray, tours, missions, time & light, sound, settings and the teacher link.
 * Called once from main.ts after the shell, engine API and ruler exist.
 */
import { ambient, mountAudio } from './ui/audio';
import { mountCompare } from './ui/compare';
import { ICONS, applyMotionClass } from './ui/feature-kit';
import { mountMissions } from './ui/missions';
import { mountSettings } from './ui/settings';
import { addToolbarButton } from './ui/shell';
import { mountTimeLight } from './ui/timelight';
import { mountTours } from './ui/tours';

export function mountFeatures() {
  applyMotionClass();
  mountCompare();
  const tours = mountTours();
  const missions = mountMissions();
  mountTimeLight();
  const sound = mountAudio();
  mountSettings(sound);
  addToolbarButton({
    id: 'teacher',
    label: 'Teacher view (opens in a new tab)',
    icon: ICONS.teacher,
    onClick: () => { window.open('teacher.html', '_blank', 'noopener'); },
  });
  // debug / test hook, mirrors window.__magnitude
  (window as unknown as { __magnitudeFeatures?: unknown }).__magnitudeFeatures = { tours, missions, sound, audio: ambient };
  return { tours, missions, sound };
}
