import React from 'react';

import { Card, CardContent } from '../ui/card';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';

interface FeatureToggleCardProps {
  title: string;
  description?: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

export function FeatureToggleCard({
  title,
  description,
  enabled,
  onToggle,
  disabled = false,
}: FeatureToggleCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-row items-center justify-between p-4">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">{title}</Label>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={disabled}
        />
      </CardContent>
    </Card>
  );
}
