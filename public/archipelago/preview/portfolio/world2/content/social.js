import { contact } from '../../content/profile.js';
export const STATIONS = ['github', 'linkedin', 'email', 'cv'];
export const STATION_ICONS = {
    github: 'gitHubPhysicalDynamic',
    linkedin: 'linkedInPhysicalDynamic',
    email: 'mailPhysicalDynamic',
};
export const isPending = (entry) => entry.id === 'cv' && entry.dataStatus === 'placeholder';
export const hasStation = (entry) => STATIONS.includes(entry.id);
export const interactiveContacts = (list = contact) => list.filter(entry => hasStation(entry) && !isPending(entry));
export function shortValue(entry) {
    if (isPending(entry))
        return 'On request';
    return entry.value.replace(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com)\//i, '');
}
