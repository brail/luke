'use client';

import React from 'react';

import { useAppContext } from '../../contexts/AppContextProvider';
import { useContextMutation } from '../../contexts/useContextMutation';
import { trpc } from '../../lib/trpc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Skeleton } from '../ui/skeleton';

import { BrandAvatar } from './BrandAvatar';

/**
 * Componente selettore per Brand e Season nella navbar
 *
 * Due Select indipendenti che permettono di cambiare Brand e Season
 * mantenendo l'altro valore corrente.
 */
export function ContextSelector() {
  const { brand, season } = useAppContext();
  const { setContext, isPending } = useContextMutation();

  // Query per ottenere le liste di Brand e Season
  const { data: brands = [], isLoading: brandsLoading } =
    trpc.catalog.brands.useQuery();
  const { data: seasons = [], isLoading: seasonsLoading } =
    trpc.catalog.seasons.useQuery();

  // Loading state
  if (brandsLoading || seasonsLoading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  // Handler per cambio Brand
  const handleBrandChange = (brandId: string) => {
    if (season) {
      setContext({ brandId, seasonId: season.id });
    }
  };

  // Handler per cambio Season
  const handleSeasonChange = (seasonId: string) => {
    if (brand) {
      setContext({ brandId: brand.id, seasonId });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Brand Selector */}
      <Select
        value={brand?.id || ''}
        onValueChange={handleBrandChange}
        disabled={isPending}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Brand">
            {brand && (
              <div className="flex items-center gap-2">
                <BrandAvatar
                  logoUrl={brand.logoUrl}
                  code={brand.code}
                  size="sm"
                />
                <span className="truncate">
                  {brand.code} - {brand.name}
                </span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {brands.map(brandItem => (
            <SelectItem key={brandItem.id} value={brandItem.id}>
              <div className="flex items-center gap-2">
                <BrandAvatar
                  logoUrl={brandItem.logoUrl}
                  code={brandItem.code}
                  size="sm"
                />
                <span>
                  {brandItem.code} - {brandItem.name}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Season Selector */}
      <Select
        value={season?.id || ''}
        onValueChange={handleSeasonChange}
        disabled={isPending}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Season">
            {season && (
              <span className="truncate">
                {season.code} {season.year} - {season.name}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {seasons.map(seasonItem => (
            <SelectItem key={seasonItem.id} value={seasonItem.id}>
              <span>
                {seasonItem.code} {seasonItem.year} - {seasonItem.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
