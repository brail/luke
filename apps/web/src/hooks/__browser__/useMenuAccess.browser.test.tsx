import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { useMenuAccess } from '../useMenuAccess';

/**
 * The sidebar map `useMenuAccess` derives from the effective section access. Mocks only
 * `useSectionAccess` — the server's answer, already resolved by `effectiveSectionAccess`, where a
 * parent is on iff one of its children is (ADR-027). Each item reads its own section: these cases
 * pin which section decides which item, and that a child stays off while a sibling keeps the
 * parent on — the case that once showed the pricing and collection layout links to users whose
 * sections were off.
 */

const { fakeAccess } = vi.hoisted(() => ({
  fakeAccess: vi.fn<() => Record<string, boolean>>(),
}));

vi.mock('../useSectionAccess', () => ({ useSectionAccess: fakeAccess }));

type MenuAccess = ReturnType<typeof useMenuAccess>;

async function menuFor(access: Record<string, boolean>): Promise<MenuAccess> {
  fakeAccess.mockReturnValue(access);
  let menu: MenuAccess | null = null;
  function Harness() {
    menu = useMenuAccess();
    return null;
  }
  await render(<Harness />);
  if (menu === null) throw new Error('useMenuAccess did not render');
  return menu;
}

describe('useMenuAccess', () => {
  test('an item follows its own section', async () => {
    const menu = await menuFor({
      settings: true,
      'settings.users': true,
      'settings.mail': false,
    });
    expect(menu.settingsItems.users).toBe(true);
    expect(menu.settingsItems.mail).toBe(false);
    expect(menu.settings).toBe(true);
  });

  test('an item stays off when only a sibling turns its parent on', async () => {
    const menu = await menuFor({
      admin: true,
      'admin.brands': true,
      'admin.seasons': false,
      product: true,
      'product.control': true,
      'product.merchandising_plan': false,
    });
    expect(menu.adminItems.seasons).toBe(false);
    expect(menu.adminItems.brands).toBe(true);
    expect(menu.productItems.merchandisingPlan).toBe(false);
    expect(menu.productItems.control).toBe(true);
    expect(menu.productItems.pricing).toBeFalsy();
    expect(menu.productItems.collectionLayout).toBeFalsy();
  });

  test('pricing and collection layout follow their own sections', async () => {
    const menu = await menuFor({
      product: true,
      'product.pricing': true,
      'product.collection_layout': false,
    });
    expect(menu.productItems.pricing).toBe(true);
    expect(menu.productItems.collectionLayout).toBe(false);
  });

  test('a group shows iff one of its items does', async () => {
    const off = await menuFor({
      maintenance: false,
      'maintenance.backup': false,
    });
    expect(off.maintenance).toBe(false);
    expect(off.showSystemSection).toBe(false);

    const on = await menuFor({ maintenance: true, 'maintenance.backup': true });
    expect(on.maintenance).toBe(true);
    expect(on.maintenanceItems.backup).toBe(true);
    expect(on.showSystemSection).toBe(true);
  });

  test('while the access map loads, every item is off', async () => {
    const menu = await menuFor({});
    for (const items of [
      menu.settingsItems,
      menu.maintenanceItems,
      menu.adminItems,
      menu.productItems,
      menu.salesItems,
    ]) {
      for (const value of Object.values(items)) expect(value).toBeFalsy();
    }
    expect(menu.settings).toBe(false);
    expect(menu.showSystemSection).toBe(false);
  });
});
