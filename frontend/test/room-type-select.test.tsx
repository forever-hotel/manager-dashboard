import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import RoomTypeSelect from '@/components/RoomTypeSelect';
import { room } from './promotions-fixture';
it('searches and selects room types with normal checkbox clicks and Escape dismissal', () => {
  const change = vi.fn();
  render(<RoomTypeSelect rooms={[room]} value={[]} onChange={change} disabled={false} invalid={false} />);
  const trigger = screen.getByRole('button', { name: 'Choose room types' });
  fireEvent.click(trigger);
  expect(screen.getByLabelText('Search room types')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Search room types'), { target: { value: 'missing' } });
  expect(screen.getByText('No matching room types.')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Search room types'), { target: { value: 'suite' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Suite/ }));
  expect(change).toHaveBeenCalledWith([room.id]);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByLabelText('Search room types')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
