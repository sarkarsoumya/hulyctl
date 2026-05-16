declare module "ws" {
  export class WebSocket {
    constructor(url: string, protocols?: string | string[]);
    send(data: string | Buffer): void;
    close(): void;
    on(event: string, callback: (...args: any[]) => void): void;
  }
}

declare module "@hcengineering/api-client" {
  export function connect(
    url: string,
    options: {
      email?: string;
      password?: string;
      token?: string;
      workspace: string;
    },
  ): Promise<HulyClient>;

  interface HulyClient {
    findAll<T = any>(
      _class: string,
      query: Record<string, unknown>,
      options?: { limit?: number; sort?: Record<string, number> },
    ): Promise<T[]>;

    findOne<T = any>(
      _class: string,
      query: Record<string, unknown>,
      options?: { sort?: Record<string, number> },
    ): Promise<T | null>;

    updateDoc(
      _class: string,
      space: string,
      _id: string,
      updates: Record<string, unknown>,
      fetchResult?: boolean,
    ): Promise<any>;

    addCollection(
      _class: string,
      space: string,
      attachedTo: string,
      attachedToClass: string,
      collection: string,
      attrs: Record<string, unknown>,
      id?: string,
    ): Promise<void>;

    close(): Promise<void>;
  }
}

declare module "@hcengineering/tracker" {
  const tracker: {
    class: {
      Project: string;
      Issue: string;
      IssueStatus: string;
    };
    taskTypes: {
      Issue: string;
    };
  };
  export default tracker;
}

declare module "@hcengineering/chunter" {
  const chunter: {
    class: {
      ChatMessage: string;
    };
  };
  export default chunter;
}

declare module "@hcengineering/core" {
  export enum SortingOrder {
    Ascending = 1,
    Descending = -1,
  }

  export function generateId(): string;
  export const space: {
    Space: string;
  };
}

declare module "@hcengineering/rank" {
  export function makeRank(
    before: string | undefined,
    after: string | undefined,
  ): string;
}
