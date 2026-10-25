export const notificationId = '67f4568c-89ab-4c12-b321-123456789012';
export const stockId = '77f4568c-89ab-4c12-b321-123456789012';
export const notificationsFixture = () => ({
  items: [
    {
      id: 'COMPLAINT:' + notificationId,
      type: 'COMPLAINT',
      sourceId: notificationId,
      title: 'Complaint: Room',
      status: 'SUBMITTED',
      occurredAt: '2026-10-21T00:00:00Z',
      revision: 'SUBMITTED:0',
      isRead: false,
      href: '/complaints?complaintId=' + notificationId
    },
    {
      id: 'STOCK:' + stockId,
      type: 'STOCK',
      sourceId: stockId,
      title: 'Rice',
      status: 'LOW_STOCK',
      occurredAt: '2026-10-21T00:00:00Z',
      revision: '1792540800000000',
      isRead: false,
      href: '/notifications?page=1#stock-' + stockId
    }
  ],
  total: 2,
  unread: 2,
  counts: { complaints: 1, stock: 1 },
  page: 1,
  pageSize: 20,
  queriedAt: '2026-10-21T00:00:01Z'
});
