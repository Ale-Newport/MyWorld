export const profile = {
    name: 'Alejandro Newport',
    initials: 'AN',
    location: 'London, UK',
    origin: 'Spain',
    year: '2026',
    /** Rotating identities on the landing. Order matters. */
    roles: [
        'SOFTWARE ENGINEER',
        'AI ENGINEER',
        'ML ENGINEER',
        'CREATIVE DEVELOPER',
        'PRODUCT ENGINEER',
        'FOUNDER / ENGINEER',
    ],
    /** The line everything collapses into. */
    thesis: 'I BUILD INTELLIGENT SYSTEMS.',
    thesisShort: 'I BUILD THINGS.',
    summary: 'Computer scientist and engineer building intelligent products across software, AI, data and interactive systems.',
    /** Small spatial markers used in the About chapter. */
    markers: [
        { from: 'SPAIN', to: 'LONDON' },
        { from: 'KCL', to: 'UCL' },
        { from: 'SOFTWARE', to: 'AI' },
        { from: 'ENGINEER', to: 'BUILDER' },
    ],
    closing: {
        question: "WHAT'S NEXT?",
        answer: "LET'S BUILD IT.",
        ucl: ['THE SYSTEM', 'IS STILL', 'BEING BUILT.'],
    },
};
/**
 * CENTRAL LINK CONFIG.
 * `github` is verified from the public GitHub API.
 * Items flagged `needsVerification` are conventional placeholders — replace
 * them in this file only. See CONTENT_STATUS.md.
 */
export const contact = [
    {
        id: 'email',
        label: 'Email',
        value: 'hello@alejandronewport.com',
        href: 'mailto:hello@alejandronewport.com',
        dataStatus: 'placeholder',
        needsVerification: true,
    },
    {
        id: 'github',
        label: 'GitHub',
        value: 'github.com/Ale-Newport',
        href: 'https://github.com/Ale-Newport',
        dataStatus: 'verified',
    },
    {
        id: 'linkedin',
        label: 'LinkedIn',
        value: 'linkedin.com/in/alejandro-newport',
        href: 'https://www.linkedin.com/in/alejandro-newport',
        dataStatus: 'placeholder',
        needsVerification: true,
    },
    {
        id: 'cv',
        label: 'Curriculum Vitae',
        value: 'PDF · 2026',
        href: '/assets/alejandro-newport-cv.pdf',
        dataStatus: 'placeholder',
        needsVerification: true,
    },
];
export const siteConfig = {
    url: 'https://alejandronewport.com',
    title: 'Alejandro Newport — Software & AI Engineer',
    description: 'Computer scientist and engineer building intelligent products across software, AI, data and interactive systems. King’s College London → UCL. Portfolio 2026.',
    keywords: [
        'Alejandro Newport',
        'Software Engineer',
        'AI Engineer',
        'Machine Learning Engineer',
        'Full-Stack Developer',
        'Creative Developer',
        'Product Engineer',
        'London',
        'King’s College London',
        'UCL',
    ],
    /** Placeholder until a real domain is configured. */
    dataStatus: 'placeholder',
};
