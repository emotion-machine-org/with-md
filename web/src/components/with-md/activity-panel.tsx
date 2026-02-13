'use client';

import type { ActivityItem } from '@/lib/with-md/types';

interface Props {
  activity: ActivityItem[];
}

export default function ActivityPanel({ activity }: Props) {
  return (
    <aside className="withmd-drawer-section withmd-column withmd-fill withmd-pad-3">
      <h2 className="withmd-sidebar-title">Activity</h2>
      <div className="withmd-scroll withmd-fill withmd-vstack-2 withmd-mt-2">
        {activity.length === 0 ? (
          <p className="withmd-muted-sm">No activity yet.</p>
        ) : (
          activity.map((item) => (
            <article key={item.id} className="withmd-card">
              <p className="withmd-body-sm">{item.summary}</p>
              <p className="withmd-muted-xs withmd-mt-1">
                {new Date(item.createdAt).toLocaleTimeString()}
              </p>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
