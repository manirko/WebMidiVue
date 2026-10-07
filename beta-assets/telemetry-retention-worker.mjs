// Dedicated beta D1 maintenance; no device, MIDI, audio or contact data is read.
export default {
  async scheduled(_event, env) {
    if (!env.SESSION_EVENTS) throw new Error('SESSION_EVENTS binding missing')
    // Daily pruning with a one-day margin for the declared 90-day lifetime.
    const result = await env.SESSION_EVENTS.prepare(
      "DELETE FROM session_events WHERE received_at < datetime('now', '-89 days')"
    ).run()
    if (!result?.success) throw new Error('Retention query failed')
    return {deleted: result.meta?.changes ?? 0}
  }
}
