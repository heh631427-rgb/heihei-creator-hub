import type { Client } from '@libsql/client';
export type QueryResult<T=Record<string,any>> = {results:T[];success:boolean;meta:{changes:number}};
export type Statement = {
 sql:string; args:any[];
 bind(...values:any[]):Statement;
 first<T=Record<string,any>>():Promise<T|null>;
 all<T=Record<string,any>>():Promise<QueryResult<T>>;
 run():Promise<QueryResult>;
};
export type Database = {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<QueryResult[]>};
export function adaptClient(client:Client):Database;
export function getClient():Client;
export function getDatabase():Database;
