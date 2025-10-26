/**
 * ESLint rule: no-hardcoded-url
 *
 * Prevents hardcoded URLs in frontend code to enforce centralized URL management.
 *
 * This rule detects string literals that start with 'http://' or 'https://' and
 * suggests using centralized utilities instead.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded URLs in frontend code',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          whitelist: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'URLs to whitelist (e.g., external APIs)',
          },
          ignorePatterns: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'File patterns to ignore',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      hardcodedUrl:
        'Hardcoded URL detected: "{{url}}". Use buildApiUrl() or getPublicUrl() instead.',
      suggestApiUrl: 'Use buildApiUrl("{{path}}") for API endpoints',
      suggestPublicUrl:
        'Use getPublicUrl("{{bucket}}", "{{key}}") for storage URLs',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const whitelist = options.whitelist || [];
    const ignorePatterns = options.ignorePatterns || [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/test/**',
      '**/tests/**',
      '**/__tests__/**',
    ];

    // Check if file should be ignored
    const filename = context.getFilename();
    const shouldIgnore = ignorePatterns.some(pattern => {
      const regex = new RegExp(
        pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
      );
      return regex.test(filename);
    });

    if (shouldIgnore) {
      return {};
    }

    // Only apply to frontend files
    if (!filename.includes('apps/web/src')) {
      return {};
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') {
          return;
        }

        const url = node.value;

        // Check if it's a URL
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return;
        }

        // Check whitelist and external URLs
        const externalWhitelist = [
          'http://www.w3.org', // SVG namespace
          'https://www.w3.org', // SVG namespace
          'https://luke.example.com', // Example domain in documentation
          'http://localhost:3000', // Frontend localhost (not API)
        ];

        const isWhitelisted =
          whitelist.some(whitelistedUrl => url.includes(whitelistedUrl)) ||
          externalWhitelist.some(whitelistedUrl =>
            url.includes(whitelistedUrl)
          );

        if (isWhitelisted) {
          return;
        }

        // Provide specific suggestions based on URL pattern
        let suggestion = null;
        let fix = null;

        if (url.includes('localhost:3001') || url.includes('/trpc/')) {
          // API URL - suggest buildApiUrl
          const pathMatch = url.match(/\/trpc\/(.+)$/);
          if (pathMatch) {
            const path = pathMatch[1];
            suggestion = 'suggestApiUrl';
            fix = {
              range: node.range,
              text: `buildApiUrl('/trpc/${path}')`,
            };
          } else {
            const pathMatch2 = url.match(/localhost:3001(.+)$/);
            if (pathMatch2) {
              const path = pathMatch2[1];
              suggestion = 'suggestApiUrl';
              fix = {
                range: node.range,
                text: `buildApiUrl('${path}')`,
              };
            }
          }
        } else if (url.includes('/uploads/') || url.includes('/api/uploads/')) {
          // Storage URL - suggest getPublicUrl
          const bucketMatch = url.match(/\/(?:api\/)?uploads\/([^/]+)\//);
          const keyMatch = url.match(/\/(?:api\/)?uploads\/[^/]+\/(.+)$/);

          if (bucketMatch && keyMatch) {
            const bucket = bucketMatch[1];
            const key = keyMatch[1];
            suggestion = 'suggestPublicUrl';
            fix = {
              range: node.range,
              text: `getPublicUrl('${bucket}', '${key}')`,
            };
          }
        }

        context.report({
          node,
          messageId: 'hardcodedUrl',
          data: {
            url: url.length > 50 ? url.substring(0, 50) + '...' : url,
          },
          fix,
        });
      },

      TemplateLiteral(node) {
        // Check template literals for URL construction
        if (node.quasis.length === 0) {
          return;
        }

        const fullText = node.quasis.map(q => q.value.raw).join('');

        // Look for patterns like `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/path`
        const apiUrlPattern =
          /\$\{process\.env\.NEXT_PUBLIC_API_URL\s*\|\|\s*['"`]http:\/\/localhost:3001['"`]\}\/(.+)/;
        const match = fullText.match(apiUrlPattern);

        if (match) {
          const path = match[1];
          context.report({
            node,
            messageId: 'hardcodedUrl',
            data: {
              url: 'Template literal with hardcoded localhost URL',
            },
            fix: {
              range: node.range,
              text: `buildApiUrl('/${path}')`,
            },
          });
        }
      },
    };
  },
};
