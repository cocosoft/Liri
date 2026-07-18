//
/**
 * 动态客户端注册服务
 * 基于RFC 7591标准实现OAuth动态客户端注册
 */

import { logger } from '@modules/infrastructure';
import { OAuthClient } from './OAuthClient';
import type { OAuthServerMetadata } from '../types/OAuthDiscoveryTypes';

/**
 * 客户端元数据
 */
export interface ClientMetadata {
  redirectUris?: string[];
  tokenEndpointAuthMethod?: string;
  grantTypes?: string[];
  responseTypes?: string[];
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  scope?: string;
  contacts?: string[];
  tosUri?: string;
  policyUri?: string;
  jwksUri?: string;
  jwks?: Record<string, unknown>;
  softwareId?: string;
  softwareVersion?: string;
}

/**
 * 客户端注册响应
 */
export interface ClientRegistrationResponse {
  clientId: string;
  clientSecret?: string;
  registrationAccessToken?: string;
  registrationClientUri?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  redirectUris?: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  clientName?: string;
  scope?: string;
}

/**
 * 动态客户端注册服务
 */
export class DynamicClientReg {
  private client: OAuthClient;

  constructor(timeout: number = 15000) {
    this.client = new OAuthClient(undefined, timeout);
  }

  /**
   * 注册客户端
   */
  async registerClient(
    registrationEndpoint: string,
    metadata: ClientMetadata
  ): Promise<ClientRegistrationResponse> {
    logger.info(`Registering OAuth client at ${registrationEndpoint}`);

    const requestBody = {
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
      grant_types: metadata.grantTypes,
      response_types: metadata.responseTypes,
      client_name: metadata.clientName,
      client_uri: metadata.clientUri,
      logo_uri: metadata.logoUri,
      scope: metadata.scope,
      contacts: metadata.contacts,
      tos_uri: metadata.tosUri,
      policy_uri: metadata.policyUri,
      jwks_uri: metadata.jwksUri,
      jwks: metadata.jwks,
      software_id: metadata.softwareId,
      software_version: metadata.softwareVersion,
    };

    const response = await this.client.httpPostJson(
      registrationEndpoint,
      requestBody
    );

    const result: ClientRegistrationResponse = {
      clientId: response.client_id as string,
      clientSecret: response.client_secret as string | undefined,
      registrationAccessToken: response.registration_access_token as
        | string
        | undefined,
      registrationClientUri: response.registration_client_uri as
        | string
        | undefined,
      clientIdIssuedAt: response.client_id_issued_at as number | undefined,
      clientSecretExpiresAt: response.client_secret_expires_at as
        | number
        | undefined,
      redirectUris: response.redirect_uris as string[] | undefined,
      grantTypes: response.grant_types as string[] | undefined,
      responseTypes: response.response_types as string[] | undefined,
      clientName: response.client_name as string | undefined,
      scope: response.scope as string | undefined,
    };

    logger.info(`OAuth client registered successfully: ${result.clientId}`);
    return result;
  }

  /**
   * 读取客户端信息
   */
  async readClient(
    registrationClientUri: string,
    registrationAccessToken: string
  ): Promise<ClientRegistrationResponse> {
    logger.debug(`Reading OAuth client info from ${registrationClientUri}`);

    const response = await (this.client as any)['httpGetJson'](
      registrationClientUri,
      {
        Authorization: `Bearer ${registrationAccessToken}`,
      }
    );

    return {
      clientId: response.client_id as string,
      clientSecret: response.client_secret as string | undefined,
      registrationAccessToken: response.registration_access_token as
        | string
        | undefined,
      registrationClientUri: response.registration_client_uri as
        | string
        | undefined,
      clientIdIssuedAt: response.client_id_issued_at as number | undefined,
      clientSecretExpiresAt: response.client_secret_expires_at as
        | number
        | undefined,
      redirectUris: response.redirect_uris as string[] | undefined,
      grantTypes: response.grant_types as string[] | undefined,
      responseTypes: response.response_types as string[] | undefined,
      clientName: response.client_name as string | undefined,
      scope: response.scope as string | undefined,
    };
  }

  /**
   * 更新客户端信息
   */
  async updateClient(
    registrationClientUri: string,
    registrationAccessToken: string,
    metadata: Partial<ClientMetadata>
  ): Promise<ClientRegistrationResponse> {
    logger.info(`Updating OAuth client at ${registrationClientUri}`);

    const requestBody = {
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
      grant_types: metadata.grantTypes,
      response_types: metadata.responseTypes,
      client_name: metadata.clientName,
      client_uri: metadata.clientUri,
      logo_uri: metadata.logoUri,
      scope: metadata.scope,
      contacts: metadata.contacts,
      tos_uri: metadata.tosUri,
      policy_uri: metadata.policyUri,
      jwks_uri: metadata.jwksUri,
      jwks: metadata.jwks,
      software_id: metadata.softwareId,
      software_version: metadata.softwareVersion,
    };

    const response = await (this.client as any)['httpPostJson'](
      registrationClientUri,
      requestBody,
      {
        Authorization: `Bearer ${registrationAccessToken}`,
        'Content-Type': 'application/json',
      }
    );

    return {
      clientId: response.client_id as string,
      clientSecret: response.client_secret as string | undefined,
      registrationAccessToken: response.registration_access_token as
        | string
        | undefined,
      registrationClientUri: response.registration_client_uri as
        | string
        | undefined,
      clientIdIssuedAt: response.client_id_issued_at as number | undefined,
      clientSecretExpiresAt: response.client_secret_expires_at as
        | number
        | undefined,
      redirectUris: response.redirect_uris as string[] | undefined,
      grantTypes: response.grant_types as string[] | undefined,
      responseTypes: response.response_types as string[] | undefined,
      clientName: response.client_name as string | undefined,
      scope: response.scope as string | undefined,
    };
  }

  /**
   * 删除客户端
   */
  async deleteClient(
    registrationClientUri: string,
    registrationAccessToken: string
  ): Promise<void> {
    logger.info(`Deleting OAuth client at ${registrationClientUri}`);

    await (this.client as any)['httpDelete'](registrationClientUri, {
      Authorization: `Bearer ${registrationAccessToken}`,
    });

    logger.info('OAuth client deleted successfully');
  }

  /**
   * 检查是否支持动态客户端注册
   */
  isSupported(metadata: OAuthServerMetadata): boolean {
    return !!metadata.registrationEndpoint;
  }
}
