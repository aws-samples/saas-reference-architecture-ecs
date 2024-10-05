export interface ContainerInfo {
  name: string
  image: string
  memoryLimitMiB: number
  cpu: number
  containerPort: number
  policy?: string
  database?: {
    kind: string
    sortKey?: string,
    tableName: string
  }
}

// export interface Database {
//   kind: string
//   sortKey?: string,
//   tableName: string
// }