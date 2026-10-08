-- Cover private signaling foreign keys for retention/employee lifecycle checks.
create index screen_share_attendance_session on admin_private.screen_shares(attendance_session_id);
create index screen_share_ended_by on admin_private.screen_shares(ended_by);
create index screen_peer_viewer on admin_private.screen_peers(viewer_id);
create index screen_peer_ended_by on admin_private.screen_peers(ended_by);
create index screen_signal_sender on admin_private.screen_signals(sender_id);
