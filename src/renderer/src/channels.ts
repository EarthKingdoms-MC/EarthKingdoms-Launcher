/**
 * Modes de jeu du launcher : « Jeu » (production) et « Bêta ».
 *
 * La clé interne (`game` / `beta`) est ce que manipulent le code et le process
 * main (profils `beta-perf-*`, catalogue séparé, drapeau `beta`). Le LIBELLÉ
 * affiché est isolé ici : renommer « Bêta » en « Dev » ne demande de changer que
 * `label` ci-dessous, sans toucher aux profils, à la persistance ni au lancement.
 */
export type Channel = 'game' | 'beta'

export const CHANNELS: Record<Channel, { label: string }> = {
    game: { label: 'Jeu'  },
    beta: { label: 'Bêta' },
}

/** Le main process identifie le mode bêta par un booléen. */
export const isBetaChannel = (channel: Channel): boolean => channel === 'beta'

/** Identifiant du palier intégré d'un niveau pour un mode donné (voir store.ts : builtinIdFor). */
export const builtinProfileId = (channel: Channel, level: string): string =>
    `${channel === 'beta' ? 'beta-' : ''}perf-${level}`
