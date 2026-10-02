// dsh-sidebar-marks — host half.
//
// Intentionally inert. Every behaviour of this plugin (the tag dot in the
// session row's leading cell, the block colour / font size annotations, the
// `标记…` row-menu entry and the marker panel) lives in the browser half,
// lib/client.js.
//
// Why a host half exists at all: the DSH client-modules scanner only publishes
// a browser bundle for packages that are *enabled Loader entries*
// (cordis.patch.yml below). There is no host-only-free client plugin.
//
// Persistence note: this version stores marks in the browser's localStorage
// (`dsh.sidebar-marks.v1`), matching the official sidebar-right /
// conversation view-state precedent. To make marks survive a browser switch,
// give the entry below a `Config` with one `.volatile()` JSON string and read
// it from the browser half through `ctx.configForms.get('sidebar-marks')`;
// the client half already funnels every read/write through `loadMarks` /
// `saveMarks`, so that swap stays local to lib/client.js.

const name = 'sidebar-marks'
const inject = []

/**
 * Report that the host half is composed; the browser half does the work.
 * @param ctx Host plugin context.
 */
function apply(ctx) {
  ctx.logger.info(
    'dsh-sidebar-marks: host half is inert; lib/client.js renders the sidebar conversation markers'
  )
}

export { apply, inject, name }
