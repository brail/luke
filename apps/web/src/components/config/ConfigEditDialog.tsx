/**
 * Dialog per creare o modificare una configurazione
 * Include validazione client-side e gestione stati di loading
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  CATEGORIES,
  validateConfigKey,
  validateConfigValue,
  getCategoryFromKey,
} from '../../lib/config-helpers';

interface ConfigEditDialogProps {
  onOpenChange: () => void;
  config?: {
    key: string;
    value: string;
    isEncrypted: boolean;
  } | null;
  onSave: (formData: {
    key: string;
    value: string;
    encrypt: boolean;
    category?: string;
  }) => Promise<void>;
  isLoading?: boolean;
}

export function ConfigEditDialog({
  onOpenChange,
  config,
  onSave,
  isLoading = false,
}: ConfigEditDialogProps) {
  const [formData, setFormData] = useState({
    key: '',
    value: '',
    encrypt: false,
    category: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isEdit = !!config;

  // Reset form quando si apre/chiude il dialog
  useEffect(() => {
    if (config !== null) {
      // Dialog sempre aperto quando renderizzato
      if (config) {
        setFormData({
          key: config.key,
          value: config.value,
          encrypt: config.isEncrypted,
          category: getCategoryFromKey(config.key),
        });
      } else {
        setFormData({
          key: '',
          value: '',
          encrypt: false,
          category: '',
        });
      }
      setErrors({});
    }
  }, [config]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    const keyValidation = validateConfigKey(formData.key);
    if (!keyValidation.valid) {
      newErrors.key = keyValidation.error!;
    }

    const valueValidation = validateConfigValue(formData.value);
    if (!valueValidation.valid) {
      newErrors.value = valueValidation.error!;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      await onSave({
        key: formData.key,
        value: formData.value,
        encrypt: formData.encrypt,
        category: formData.category || undefined,
      });
      onOpenChange();
    } catch {
      // Error handling è gestito dal componente padre
    }
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear error quando l'utente inizia a digitare
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Modifica Configurazione' : 'Nuova Configurazione'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Modifica i dettagli della configurazione esistente.'
              : "Crea una nuova configurazione per l'applicazione."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key">Chiave</Label>
            <Input
              id="key"
              value={formData.key}
              onChange={e => handleInputChange('key', e.target.value)}
              placeholder="es. auth.ldap.url"
              disabled={isEdit || isLoading}
              className={errors.key ? 'border-destructive' : ''}
            />
            {errors.key && (
              <p className="text-sm text-destructive">{errors.key}</p>
            )}
            {!isEdit && (
              <p className="text-xs text-muted-foreground">
                Formato: categoria.sottocategoria.valore (es. auth.ldap.url)
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="value">Valore</Label>
            <Textarea
              id="value"
              value={formData.value}
              onChange={e => handleInputChange('value', e.target.value)}
              placeholder="Inserisci il valore della configurazione"
              rows={4}
              disabled={isLoading}
              className={errors.value ? 'border-destructive' : ''}
            />
            {errors.value && (
              <p className="text-sm text-destructive">{errors.value}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Categoria (opzionale)</Label>
            <Select
              value={formData.category}
              onValueChange={value => handleInputChange('category', value)}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona categoria" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(category => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Se non specificata, verrà dedotta automaticamente dalla chiave
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="encrypt"
              checked={formData.encrypt}
              onChange={e => handleInputChange('encrypt', e.target.checked)}
              disabled={isLoading}
              className="rounded border-gray-300"
            />
            <Label htmlFor="encrypt" className="text-sm">
              Cifra il valore (AES-256-GCM)
            </Label>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange()}
              disabled={isLoading}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              disabled={
                isLoading || !formData.key?.trim() || !formData.value?.trim()
              }
            >
              {isLoading ? 'Salvataggio...' : isEdit ? 'Aggiorna' : 'Crea'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
