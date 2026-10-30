import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import StaffAccounts from '@/components/StaffAccounts';
import { staffFixture, staffPageFixture, staffInputFixture } from './staff-fixture';
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(
    async (url: string, options?: RequestInit) =>
      new Response(JSON.stringify(options?.method ? {} : url.includes('?') ? staffPageFixture() : staffFixture()))
  );
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fill() {
  const values = staffInputFixture();
  for (const [label, key] of [
    ['Full name', 'name'],
    ['Vocation', 'vocation'],
    ['Email', 'email'],
    ['Phone', 'phone'],
    ['NIC', 'nic'],
    ['Age', 'age'],
    ['Role', 'role']
  ] as const)
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: values[key] }
    });
}
describe('DDP-029 staff management', () => {
  it('AC1: supports all roles and required fields and queues credential delivery', async () => {
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    expect(screen.queryByText('Staff credential delivery status')).not.toBeInTheDocument();
    expect(screen.queryByText('Staff filters and refresh')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add new' })).not.toBeInTheDocument();
    for (const name of ['Day', 'Week', 'Month']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    for (const name of ['Receptionist', 'Worker', 'Kitchen Staff', 'Kitchen Manager'])
      expect(within(screen.getByLabelText('Role')).getByRole('option', { name })).toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/staff',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(staffInputFixture())
        })
      )
    );
    await screen.findByText('Account created. Credentials are queued for email delivery.');
    expect(screen.getByLabelText('Full name')).toHaveValue('');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it('AC2: edits fields and roles with the current version then refreshes', async () => {
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Test Worker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Test Worker'));
    fireEvent.change(screen.getByLabelText('Role'), {
      target: { value: 'KITCHEN_MANAGER' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Profile saved. Existing sessions were invalidated.');
    const call = fetchMock.mock.calls.find(([, o]) => o?.method === 'PATCH');
    expect(JSON.parse(call![1]!.body as string)).toMatchObject({
      role: 'KITCHEN_MANAGER',
      version: 0
    });
  });
  it.each(['Deactivate', 'Delete account'])('AC2: requires confirmation for %s', async name => {
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Test Worker' }));
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(fetchMock.mock.calls.some(([, o]) => o?.method)).toBe(false);
    fireEvent.click(
      screen.getByRole('button', {
        name: name === 'Delete account' ? 'Confirm deletion' : 'Confirm deactivation'
      })
    );
    await waitFor(() => expect(fetchMock.mock.calls.some(([, o]) => o?.method)).toBe(true));
    const call = fetchMock.mock.calls.find(([, o]) => o?.method);
    expect(call![1]!.method).toBe(name === 'Delete account' ? 'DELETE' : 'PATCH');
    expect(JSON.parse(call![1]!.body as string)).toEqual(
      name === 'Delete account' ? { version: 0 } : { version: 0, isActive: false }
    );
  });
  it('DDP-048: focuses confirmation and returns focus to its opener on Escape', async () => {
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Test Worker' }));
    const trigger = screen.getByRole('button', { name: 'Deactivate' });
    trigger.focus();
    fireEvent.click(trigger);
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveAccessibleDescription(/invalidates existing sessions/);
    fireEvent.keyDown(confirmation, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Test Worker' })).toHaveFocus();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method)).toBe(false);
  });
  it('AC3: retains form input on conflicts and supports deliberate version reload', async () => {
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Test Worker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Test Worker'));
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'My draft' }
    });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/account changed or these unique details/);
    expect(screen.getByLabelText('Full name')).toHaveValue('My draft');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...staffFixture(), version: 2 })));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Reload current version and keep draft'
      })
    );
    await screen.findByText(/Current version loaded/);
    expect(screen.getByLabelText('Full name')).toHaveValue('My draft');
  });
  it('lists inactive accounts without reset or deactivate actions', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...staffPageFixture(),
          items: [{ ...staffFixture(), isActive: false, deliveryStatus: 'failed' }]
        })
      )
    );
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    expect(screen.queryByRole('button', { name: 'Reset pwd' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Test Worker' }));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm activation' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/staff/' + staffFixture().staffId,
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ version: 0, isActive: true }) })
      )
    );
    await screen.findByText('Staff account activated.');
  });
  it('reports service failures and allows directory retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    render(<StaffAccounts />);
    await screen.findByText(/Service unavailable/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Test Worker');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Test Worker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep account unchanged' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
  it('retains invalid create input and cancels a draft explicitly', async () => {
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    fill();
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: 'invalid' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('phone (7-15 digits, optional +)');
    expect(screen.getByLabelText('Full name')).toHaveValue('New Worker');
    expect(fetchMock.mock.calls.some(([, o]) => o?.method)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Full name')).toHaveValue('');
  });
  it('paginates without changing a draft', async () => {
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify({
            ...staffPageFixture(),
            page: url.includes('page=2') ? 2 : 1,
            total: 21,
            items: Array.from({ length: url.includes('page=2') ? 1 : 20 }, (_, index) => ({
              ...staffFixture(),
              staffId: '67f4568c-89ab-4c12-b321-' + String(index + (url.includes('page=2') ? 20 : 0)).padStart(12, '0'),
              name: index === 0 ? 'Test Worker' : 'Worker ' + index
            }))
          })
        )
    );
    render(<StaffAccounts />);
    await screen.findByText('Test Worker');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Next accounts' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/staff?page=2&pageSize=20', expect.any(Object)));
    expect(screen.getByLabelText('Full name')).toHaveValue('New Worker');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous accounts' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Previous accounts' }));
    await waitFor(() => expect(screen.getByText('1–20 of 21 accounts')).toBeVisible());
  });
});
