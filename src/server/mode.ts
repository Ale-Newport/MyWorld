/* ============================================================
   EDITOR OR DEPLOYED SITE

   The portfolio runs in two modes. In the EDITOR (your own machine:
   `npm run dev`, tests, QA servers) drafts, the media library, the
   world studio and publishing exist, backed by the local store. The
   DEPLOYED site (a production build) has none of that: it serves
   exactly what is committed in the repository — content/published/
   and the world seed — and prerenders its pages, with no database
   in the path of a visit. Publishing in the editor is what changes
   those files (and pushes them).

   `CMS_EDITOR=1` turns the editor on in a production build, for
   checking it locally.
   ============================================================ */
export const EDITOR = process.env.NODE_ENV !== 'production' || process.env.CMS_EDITOR === '1'
