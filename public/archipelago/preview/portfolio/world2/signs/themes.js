import { TOKENS } from './palette.js';
const terracotta = { ribbon: '#a8431f', ribbonDeep: '#7e3115', ribbonInk: TOKENS.cream, accent: TOKENS.terracotta };
const teal = { ribbon: '#2f6f5e', ribbonDeep: '#1f4d41', ribbonInk: TOKENS.cream, accent: TOKENS.teal };
const leaf = { ribbon: '#4b6a1d', ribbonDeep: '#344a13', ribbonInk: TOKENS.cream, accent: TOKENS.leaf };
const ochre = { ribbon: TOKENS.gold, ribbonDeep: '#a9790a', ribbonInk: TOKENS.ink, accent: '#a9790a' };
const timber = { ribbon: TOKENS.woodDark, ribbonDeep: '#3b3524', ribbonInk: TOKENS.cream, accent: TOKENS.copper };
export const SIGN_THEMES = {
    chess: { id: 'chess', emblem: 'chess', ...terracotta, charm: 'pawn', hardware: 'oak' },
    stock: { id: 'stock', emblem: 'stock', ...teal, charm: 'coin', hardware: 'rope' },
    orbit: { id: 'orbit', emblem: 'orbit', ...timber, charm: 'planet', hardware: 'oak' },
    gym: { id: 'gym', emblem: 'gym', ...terracotta, charm: 'dumbbell', hardware: 'rope' },
    pipeline: { id: 'pipeline', emblem: 'pipeline', ...leaf, charm: 'leaf', hardware: 'vine' },
    tunnel: { id: 'tunnel', emblem: 'tunnel', ...teal, charm: 'padlock', hardware: 'chain' },
    timeline: { id: 'timeline', emblem: 'timeline', ...ochre, charm: 'diamond', hardware: 'oak' },
    maze: { id: 'maze', emblem: 'maze', ...leaf, charm: 'compass', hardware: 'vine' },
    rings: { id: 'rings', emblem: 'rings', ...terracotta, charm: 'acorn', hardware: 'oak' },
    browser: { id: 'browser', emblem: 'browser', ...teal, charm: 'pennant', hardware: 'rope' },
    cards: { id: 'cards', emblem: 'cards', ...terracotta, charm: 'cards', hardware: 'oak' },
    jobs: { id: 'jobs', emblem: 'jobs', ...teal, charm: 'pennant', hardware: 'rope' },
    voxel: { id: 'voxel', emblem: 'voxel', ...leaf, charm: 'gear', hardware: 'oak' },
    books: { id: 'books', emblem: 'books', ...terracotta, charm: 'books', hardware: 'oak' },
    dots: { id: 'dots', emblem: 'dots', ...ochre, charm: 'diamond', hardware: 'rope' },
    plain: { id: 'plain', emblem: null, ...timber, charm: 'none', hardware: 'oak' },
};
export const DEFAULT_THEME = SIGN_THEMES.rings;
export const MOTION_THEME = {
    ChessMotion: 'chess', StockMotion: 'stock', ThreeBodyMotion: 'orbit', GymMotion: 'gym',
    FocusMotion: 'pipeline', VideoPlayerMotion: 'pipeline', VpnMotion: 'tunnel',
    KeyframesMotion: 'timeline', TrainingMotion: 'timeline', LabyrinthMotion: 'maze', CatanMotion: 'maze',
    PrimesMotion: 'rings', GenericProjectMotion: 'rings', WebsiteMotion: 'browser',
    CardsMotion: 'cards', JobBoardMotion: 'jobs', VoxelMotion: 'voxel', LibraryMotion: 'books', DotsBoxesMotion: 'dots',
};
const CATEGORY_THEME = {
    'ai / ml': 'rings', software: 'stock', web: 'browser', mobile: 'jobs', '3d': 'orbit',
    data: 'timeline', university: 'timeline', experiment: 'maze', 'client work': 'browser',
};
export const themeById = (id) => (id ? SIGN_THEMES[id] : undefined) ?? DEFAULT_THEME;
export function themeForProject(project) {
    const byMotion = project.motion ? MOTION_THEME[project.motion] : undefined;
    if (byMotion)
        return SIGN_THEMES[byMotion];
    const byCategory = project.category ? CATEGORY_THEME[project.category.toLowerCase()] : undefined;
    return byCategory ? SIGN_THEMES[byCategory] : DEFAULT_THEME;
}
