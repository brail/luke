import type {
  MerchandisingGender,
  MerchandisingLaunchType,
  MerchandisingLifeType,
  MerchandisingPlanStatus,
} from '@luke/core';

/** Display labels of the merchandising plan values. */
export const GENDER_LABELS: Record<MerchandisingGender, string> = {
  MAN: 'Uomo',
  WOMAN: 'Donna',
  UNISEX: 'Unisex',
  KID: 'Bambino',
};

export const LIFE_TYPE_LABELS: Record<MerchandisingLifeType, string> = {
  NEW_LINE: 'New Line',
  NEW_STYLE: 'New Style',
  NEW_COLOR: 'New Color',
  CARRY_OVER: 'Carry Over',
};

export const LAUNCH_TYPE_LABELS: Record<MerchandisingLaunchType, string> = {
  SAMPLED: 'Sampled',
  OPEN_TO_BUY: 'Open to Buy',
};

export const PLAN_STATUS_LABELS: Record<MerchandisingPlanStatus, string> = {
  DRAFT: 'Bozza',
  CONFIRMED: 'Confermato',
};
