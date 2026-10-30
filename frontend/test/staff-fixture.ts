export const staffId = '67f4568c-89ab-4c12-b321-123456789012';
export const staffFixture = () => ({
  staffId,
  name: 'Test Worker',
  vocation: 'Cleaning',
  email: 'worker@example.com',
  age: 25,
  phone: '+94771234567',
  nic: '200012345678',
  username: 'staff_fixture',
  role: 'WORKER' as const,
  isActive: true,
  passwordChangeRequired: true,
  version: 0,
  deliveryStatus: 'pending' as const
});
export const staffPageFixture = () => ({
  items: [staffFixture()],
  total: 1,
  page: 1,
  pageSize: 20
});
export const staffInputFixture = () => ({
  name: 'New Worker',
  vocation: 'Cleaning',
  email: 'new@example.com',
  age: 25,
  phone: '+94771234567',
  nic: '200012345678',
  role: 'WORKER'
});
