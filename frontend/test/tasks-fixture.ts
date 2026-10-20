export const workerId = '67f4568c-89ab-4c12-b321-123456789012';
export const tasksSnapshot = (page = 1) => ({
  tasks: [
    {
      id: '77f4568c-89ab-4c12-b321-123456789012',
      roomNumber: '101',
      category: 'ROOM_CLEANING',
      priority: 'HIGH',
      status: 'ASSIGNED',
      assignee: { id: workerId, name: 'Worker One' },
      submittedAt: '2026-10-20T00:00:00Z',
      updatedAt: '2026-10-20T00:00:00Z',
      completedAt: null,
      version: 1,
    },
  ],
  total: 41,
  page,
  pageSize: 20,
  source: 'WKMS',
  readOnly: true,
  queriedAt: '2026-10-20T00:00:00Z',
});
